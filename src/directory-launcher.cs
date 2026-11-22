// Stable headless bootstrap and one-shot directory update helper. No installer/service.
using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

public sealed class DirectoryPointer { public int schema; public string version, previous; }
public sealed class DirectoryFile { public string path, sha256; public long size; }
public sealed class DirectoryManifest { public int schema; public string version; public DirectoryFile[] files; }
public sealed class DirectoryPayload {
 public string root, source, hash, version, fromVersion, result, ready, commit, cancel, token;
 public int pid, healthTimeoutMs;
}
public static class DirectoryLauncher {
 static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4*1024*1024 };
 static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
 static readonly Regex Version = new Regex(@"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$", RegexOptions.CultureInvariant);
 static readonly Regex Token = new Regex(@"^[0-9a-f]{48}$", RegexOptions.CultureInvariant);
 static readonly Regex Hex = new Regex(@"^[0-9a-fA-F]{64}$", RegexOptions.CultureInvariant);
 static DirectoryPayload Payload;
 const string Entry = "OpenClaw Desktop.exe";
 const long MaxBytes = 2L*1024*1024*1024;
 static string Hash(Stream stream) {using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
 static string Hash(string file) {using(var stream=File.OpenRead(file))return Hash(stream);}
 static bool ValidVersion(string value) { return value != null && value.Length <= 80 && Version.IsMatch(value); }
 static T ReadJson<T>(string file) { if(new FileInfo(file).Length > 4*1024*1024) throw new IOException("JSON metadata too large");return Json.Deserialize<T>(File.ReadAllText(file, Encoding.UTF8)); }
 static void NoReparse(string item) { if((File.GetAttributes(item)&FileAttributes.ReparsePoint)!=0) throw new IOException("Reparse paths are not allowed"); }
 static string VersionDirectory(string root,string version) { if(!ValidVersion(version)) throw new IOException("Invalid version");return Path.Combine(root,"versions",version); }
 static DirectoryPointer Pointer(string root) { string file=Path.Combine(root,"current.json");NoReparse(file);var value=ReadJson<DirectoryPointer>(file);if(value==null || value.schema!=1 || !ValidVersion(value.version) || (value.previous!=null && !ValidVersion(value.previous))) throw new IOException("Invalid current pointer");return value; }
 static void AtomicPointer(string root,DirectoryPointer pointer) {
  string target=Path.Combine(root,"current.json"),incoming=target+"."+Guid.NewGuid().ToString("N")+".tmp";
  var data=new Dictionary<string,object>{{"schema",pointer.schema},{"version",pointer.version}};if(pointer.previous!=null)data.Add("previous",pointer.previous);
  try {File.WriteAllText(incoming,Json.Serialize(data),Utf8);if(File.Exists(target))File.Replace(incoming,target,null,true);else File.Move(incoming,target);} finally {Clean(incoming);}
 }
 static void Log(string message) {try {using(var f=new FileStream(Payload.result+".helper.log",FileMode.Append,FileAccess.Write,FileShare.ReadWrite))using(var w=new StreamWriter(f,Utf8))w.WriteLine(DateTime.UtcNow.ToString("o")+" "+message);}catch{}}
 static void Result(string phase,string message,string backup) {File.WriteAllText(Payload.result,Json.Serialize(new Dictionary<string,object>{{"phase",phase},{"mode","directory"},{"message",message},{"backup",backup},{"version",Payload.version}}),Utf8);}
 static void Clean(string file) {try{File.Delete(file);}catch{}}
 static string Quote(string value) {
  var result=new StringBuilder("\"");int slashes=0;
  foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='\"'){result.Append('\\',slashes*2+1);result.Append(c);slashes=0;continue;}result.Append('\\',slashes);slashes=0;result.Append(c);}
  result.Append('\\',slashes*2);return result.Append('"').ToString();
 }
 static Process StartClient(string root,string version,string token,string[] args) {
  string dir=VersionDirectory(root,version);NoReparse(root);NoReparse(Path.Combine(root,"versions"));NoReparse(dir);
  string file=Path.Combine(dir,Entry);if(!File.Exists(file))throw new IOException("Version executable missing");NoReparse(file);
  var info=new ProcessStartInfo(file);info.WorkingDirectory=dir;info.UseShellExecute=false;info.CreateNoWindow=true;
  var arguments=new List<string>();foreach(string arg in args)arguments.Add(Quote(arg));info.Arguments=String.Join(" ",arguments.ToArray());
  foreach(var key in new[]{"PORTABLE_EXECUTABLE_FILE","PORTABLE_EXECUTABLE_DIR","PORTABLE_EXECUTABLE_APP_FILENAME","OPENCLAW_LAUNCH_TOKEN"})info.EnvironmentVariables.Remove(key);
  info.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
  info.EnvironmentVariables["OPENCLAW_INSTALL_ROOT"]=root;
  if(token!=null)info.EnvironmentVariables["OPENCLAW_LAUNCH_TOKEN"]=token;
  Process child=Process.Start(info);if(child==null)throw new IOException("Client did not start");return child;
 }
 // Both ZIP and manifest use one unambiguous, strictly relative POSIX namespace.
 static string Relative(string name,bool directory) {
  if(String.IsNullOrEmpty(name)||name.IndexOf('\\')>=0||name.IndexOf(':')>=0||name.IndexOf('\0')>=0||name.StartsWith("/"))throw new IOException("Unsafe archive path");
  if(directory)name=name.TrimEnd('/');
  if(String.IsNullOrEmpty(name)||name.Length>220)throw new IOException("Unsafe archive path");
  foreach(string part in name.Split('/')) {
   if(part.Length==0||part=="."||part==".."||part.EndsWith(".")||part.EndsWith(" ")||part.IndexOfAny(new[]{'<','>','"','|','?','*'})>=0)throw new IOException("Unsafe archive path");
   string stem=part.Split('.')[0];if(Regex.IsMatch(stem,@"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$",RegexOptions.IgnoreCase|RegexOptions.CultureInvariant))throw new IOException("Reserved archive path");
  }
  return name;
 }
 static string Under(string root,string relative) {
  string full=Path.GetFullPath(Path.Combine(root,relative.Replace('/',Path.DirectorySeparatorChar)));
  if(!full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("Archive path escaped staging directory");return full;
 }
 static void Extract(Stream source,string stage,string version) {
  var paths=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long declared=0,actualTotal=0;
  using(var zip=new ZipArchive(source,ZipArchiveMode.Read,true)) {
   if(zip.Entries.Count>10000)throw new IOException("Archive contains too many entries");
   foreach(var entry in zip.Entries) {
    bool directory=entry.FullName.EndsWith("/");string relative=Relative(entry.FullName,directory);
    if(!paths.Add(relative))throw new IOException("Duplicate archive path");
    uint attributes=unchecked((uint)entry.ExternalAttributes);uint type=(attributes>>16)&0xf000;
    if(type==0xa000 || (attributes&0x400)!=0 || (type!=0 && type!=0x8000 && type!=0x4000))throw new IOException("Archive links and special files are not allowed");
    if(!directory && relative!="OpenClaw.exe" && relative!="current.json" && !relative.StartsWith("versions/"+version+"/",StringComparison.Ordinal))throw new IOException("Unexpected distribution file");
    if(directory && relative!="versions" && relative!="versions/"+version && !relative.StartsWith("versions/"+version+"/",StringComparison.Ordinal))throw new IOException("Unexpected distribution directory");
    declared+=entry.Length;if(entry.Length<0||declared>MaxBytes)throw new IOException("Archive expanded size limit exceeded");
    string target=Under(stage,relative);
    if(directory){if(entry.Length!=0)throw new IOException("Directory archive entry has data");Directory.CreateDirectory(target);continue;}
    Directory.CreateDirectory(Path.GetDirectoryName(target));
    using(var input=entry.Open())using(var output=new FileStream(target,FileMode.CreateNew,FileAccess.Write,FileShare.None)) {
     byte[] buffer=new byte[65536];long count=0;int read;
     while((read=input.Read(buffer,0,buffer.Length))>0){count+=read;actualTotal+=read;if(count>entry.Length||actualTotal>MaxBytes)throw new IOException("Archive expanded size mismatch");output.Write(buffer,0,read);}
     if(count!=entry.Length)throw new IOException("Archive length mismatch");
    }
   }
  }
 }
 static void ValidateDistribution(string stage,string version) {
  if(!File.Exists(Path.Combine(stage,"OpenClaw.exe")))throw new IOException("Distribution launcher missing");
  DirectoryPointer next=Pointer(stage);if(next.version!=version)throw new IOException("Distribution version mismatch");
  string dir=VersionDirectory(stage,version);NoReparse(dir);
  string manifestPath=Path.Combine(dir,"update-manifest.json");var manifest=ReadJson<DirectoryManifest>(manifestPath);
  if(manifest==null || manifest.schema!=1 || manifest.version!=version || manifest.files==null || manifest.files.Length==0 || manifest.files.Length>10000)throw new IOException("Invalid update manifest");
  var known=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;
  foreach(var item in manifest.files) {
   if(item==null)throw new IOException("Invalid manifest record");string relative=Relative(item.path,false);
   if(relative.Equals("update-manifest.json",StringComparison.OrdinalIgnoreCase)||!known.Add(relative)||item.size<0||item.sha256==null||!Hex.IsMatch(item.sha256))throw new IOException("Invalid or duplicate manifest file");
   total+=item.size;if(total>MaxBytes)throw new IOException("Manifest size limit exceeded");string file=Under(dir,relative);
   if(!File.Exists(file)||new FileInfo(file).Length!=item.size)throw new IOException("Manifest file missing or size mismatch");NoReparse(file);
   if(!String.Equals(Hash(file),item.sha256,StringComparison.OrdinalIgnoreCase))throw new IOException("Manifest checksum mismatch");
  }
  foreach(string file in Directory.GetFiles(dir,"*",SearchOption.AllDirectories)) {
   string relative=file.Substring(dir.TrimEnd(Path.DirectorySeparatorChar).Length+1).Replace(Path.DirectorySeparatorChar,'/');
   if(relative!="update-manifest.json"&&!known.Contains(relative))throw new IOException("Unlisted version file");
  }
  if(!known.Contains(Entry))throw new IOException("Manifest executable missing");
 }
 static bool Contents(string file,string token) {try{return File.Exists(file)&&new FileInfo(file).Length<1024&&File.ReadAllText(file).Trim()==token;}catch(IOException){return false;}}
 static void StopChild(Process child) {
  if(child==null)return;try {if(child.HasExited)return;
   // Only the newly spawned update PID and its descendants; never a name-based kill.
   var info=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"taskkill.exe"),"/PID "+child.Id+" /T /F");info.UseShellExecute=false;info.CreateNoWindow=true;
   using(var killer=Process.Start(info)){if(killer!=null)killer.WaitForExit(10000);}if(!child.WaitForExit(10000))throw new IOException("New client did not exit");
  }catch(InvalidOperationException){}
 }
 static int Apply(string payloadFile) {
  bool committed=false,exited=false,switched=false,stageCreated=false;string stage=null,health=null,createdVersion=null;DirectoryPointer old=null;Process child=null;FileStream updateLock=null;
  try {
   Payload=ReadJson<DirectoryPayload>(payloadFile);
   if(Payload==null||!Path.IsPathRooted(Payload.root)||!ValidVersion(Payload.version)||Payload.token==null||!Token.IsMatch(Payload.token)||Payload.hash==null||!Hex.IsMatch(Payload.hash)||!Path.IsPathRooted(Payload.source)||!Path.IsPathRooted(Payload.result)||!Path.IsPathRooted(Payload.ready)||!Path.IsPathRooted(Payload.commit)||!Path.IsPathRooted(Payload.cancel))throw new IOException("Invalid update payload");
   if(Payload.healthTimeoutMs!=0 && (Payload.healthTimeoutMs<1000 || Payload.healthTimeoutMs>60000))throw new IOException("Invalid health timeout");
   Payload.root=Path.GetFullPath(Payload.root);NoReparse(Payload.root);
   if(!File.Exists(Path.Combine(Payload.root,"OpenClaw.exe")))throw new IOException("Managed launcher missing");
   old=Pointer(Payload.root);if(old.version==Payload.version)throw new IOException("Version is already current");
   string updates=Path.Combine(Payload.root,".update");Directory.CreateDirectory(updates);NoReparse(updates);
   string lockFile=Path.Combine(updates,"update.lock");if(File.Exists(lockFile))NoReparse(lockFile);
   updateLock=new FileStream(lockFile,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None);
   stage=Path.Combine(updates,"stage-"+Payload.token);health=Path.Combine(updates,"health-"+Payload.token+".json");
   if(Directory.Exists(stage)||File.Exists(stage))throw new IOException("Staging directory already exists");Clean(health);
   Log("helper booted");File.WriteAllText(Payload.ready,Payload.token,Utf8);
   DateTime deadline=DateTime.UtcNow.AddSeconds(40);
   while(DateTime.UtcNow<deadline) {if(File.Exists(Payload.cancel))throw new IOException("Update handoff cancelled");if(Contents(Payload.commit,Payload.token)){committed=true;break;}Thread.Sleep(100);}
   if(!committed)throw new IOException("No client commit; pointer unchanged");
   Log("commit received; waiting for client exit");
   if(Payload.pid<=0)throw new IOException("Invalid parent PID");Process parent=null;try{parent=Process.GetProcessById(Payload.pid);}catch(ArgumentException){}
   if(parent!=null)using(parent){if(!parent.WaitForExit(60000))throw new IOException("Client did not exit; pointer unchanged");}
   exited=true;if(Payload.fromVersion!=null && (!ValidVersion(Payload.fromVersion) || Pointer(Payload.root).version!=Payload.fromVersion))throw new IOException("Current version changed since update preparation");
   if(Pointer(Payload.root).version!=old.version)throw new IOException("Current pointer changed during update handoff");
   if(File.Exists(Payload.cancel))throw new IOException("Update handoff cancelled");
   Log("client exited; verifying locked archive");
   using(var source=new FileStream(Payload.source,FileMode.Open,FileAccess.Read,FileShare.Read)) {
    if(!String.Equals(Hash(source),Payload.hash,StringComparison.OrdinalIgnoreCase))throw new IOException("Downloaded ZIP checksum mismatch");
    source.Position=0;Directory.CreateDirectory(stage);stageCreated=true;Extract(source,stage,Payload.version);
   }
   ValidateDistribution(stage,Payload.version);
   string versions=Path.Combine(Payload.root,"versions");NoReparse(versions);string destination=VersionDirectory(Payload.root,Payload.version);
   if(Directory.Exists(destination)||File.Exists(destination))throw new IOException("Version directory already exists; not overwritten");
   Directory.Move(VersionDirectory(stage,Payload.version),destination);createdVersion=destination;
   AtomicPointer(Payload.root,new DirectoryPointer{schema=1,version=Payload.version,previous=old.version});switched=true;
   Log("current pointer switched; awaiting local shell health acknowledgement");child=StartClient(Payload.root,Payload.version,Payload.token,new string[0]);
   int timeout=Payload.healthTimeoutMs==0?30000:Payload.healthTimeoutMs;deadline=DateTime.UtcNow.AddMilliseconds(timeout);
   bool healthy=false;while(DateTime.UtcNow<deadline){if(Contents(health,Payload.token)){healthy=true;break;}if(child.HasExited)break;Thread.Sleep(100);}
   if(!healthy)throw new IOException("New client failed local startup health acknowledgement");
   Result("installed","Directory update installed; previous version retained.",VersionDirectory(Payload.root,old.version));Log("local shell health confirmed");return 0;
  }catch(Exception error) {
   if(Payload==null)return 3;string message=error.Message;Log(message);
   // An atomic filesystem operation can fail after the destination was created.
   // Inspect the live pointer before deciding whether the new directory is unused.
   if(exited && createdVersion!=null && old!=null) {
    try {if(Pointer(Payload.root).version==Payload.version)switched=true;}catch{}
   }
   bool canRestart=!switched;
   if(switched) {
    try{StopChild(child);AtomicPointer(Payload.root,old);switched=false;canRestart=true;Log("previous pointer restored");}
    catch(Exception rollback){message+="; rollback failed: "+rollback.Message;Log(message);}
   }
   if(createdVersion!=null && !switched && old!=null) {
    try {
     if(Pointer(Payload.root).version!=old.version)throw new IOException("Failed version may still be current; not quarantined");
     NoReparse(createdVersion);NoReparse(Path.Combine(Payload.root,"versions"));NoReparse(Path.Combine(Payload.root,".update"));
     string quarantine=Path.Combine(Payload.root,".update","failed-"+Payload.version+"-"+Payload.token);
     if(Directory.Exists(quarantine)||File.Exists(quarantine))throw new IOException("Failed-version quarantine already exists");
     var until=DateTime.UtcNow.AddSeconds(15);
     while(true){try{Directory.Move(createdVersion,quarantine);break;}catch(IOException){if(DateTime.UtcNow>=until)throw;Thread.Sleep(200);}}
     Log("failed version quarantined; same version can be retried");createdVersion=null;
    }catch(Exception quarantine){message+="; failed-version cleanup: "+quarantine.Message;Log(message);}
   }
   if(committed){try{Result("failed",message,old==null?null:VersionDirectory(Payload.root,old.version));}catch{}}
   if(exited&&canRestart&&old!=null){try{using(var previous=StartClient(Payload.root,old.version,null,new string[0])){}}catch(Exception restart){Log("Previous client restart failed: "+restart.Message);}}
   return 1;
  }finally {
   if(child!=null)child.Dispose();if(updateLock!=null)updateLock.Dispose();if(health!=null)Clean(health);
   if(stageCreated&&stage!=null&&Directory.Exists(stage)){try{Directory.Delete(stage,true);}catch{}}
   if(exited&&Payload!=null){Clean(Payload.ready);Clean(Payload.source);Clean(payloadFile);}
  }
 }
 [STAThread]
 public static int Main(string[] args) {
  if(args.Length==2&&args[0]=="--apply")return Apply(args[1]);
  try {
   string root=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
   // Prevent a second launcher racing the update health window.
   string lockFile=Path.Combine(root,".update","update.lock");if(File.Exists(lockFile)){try{using(var probe=new FileStream(lockFile,FileMode.Open,FileAccess.Read,FileShare.None)){}}catch(IOException){return 0;}}
   var current=Pointer(root);using(var child=StartClient(root,current.version,null,args)){}return 0;
  }catch(Exception error){try{string root=Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);File.AppendAllText(Path.Combine(root,"launcher.log"),DateTime.UtcNow.ToString("o")+" "+error.Message+Environment.NewLine,Utf8);}catch{}return 1;}
 }
}
