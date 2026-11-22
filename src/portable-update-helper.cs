// Headless Windows GUI-subsystem executable: no console, UI, service or installer.
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Web.Script.Serialization;

public sealed class UpdatePayload {
 public string target, source, hash, result, ready, commit, cancel, token, version;
 public int pid;
}
public static class PortableUpdateHelper {
 static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
 static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
 static UpdatePayload Payload;
 static string Hash(string file) {
  using(var sha=SHA256.Create()) using(var stream=File.OpenRead(file))
   return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();
 }
 static void Log(string message) {
  try { using(var f=new FileStream(Payload.result+".helper.log",FileMode.Append,FileAccess.Write,FileShare.ReadWrite))
   using(var w=new StreamWriter(f,Utf8)) w.WriteLine(DateTime.UtcNow.ToString("o")+" "+message); } catch {}
 }
 static void Result(string phase,string message,string backup) {
  var data=new Dictionary<string,object>{{"phase",phase},{"message",message},{"backup",backup},{"version",Payload.version}};
  File.WriteAllText(Payload.result,Json.Serialize(data),Utf8);
 }
 static void StartClient() {
  var info=new ProcessStartInfo(Payload.target);
  info.WorkingDirectory=Path.GetDirectoryName(Payload.target);
  info.UseShellExecute=false;info.CreateNoWindow=true;
  foreach(var key in new[]{"PORTABLE_EXECUTABLE_FILE","PORTABLE_EXECUTABLE_DIR","PORTABLE_EXECUTABLE_APP_FILENAME","ELECTRON_RUN_AS_NODE"}) info.EnvironmentVariables.Remove(key);
  using(var child=Process.Start(info)) { if(child==null) throw new IOException("Client did not start"); }
 }
 static void Clean(string file) { try { File.Delete(file); } catch {} }
 [STAThread]
 public static int Main(string[] args) {
  if(args.Length!=1)return 2;
  bool committed=false,exited=false,replaced=false;
  string incoming=null,backup=null;
  try {
   Payload=Json.Deserialize<UpdatePayload>(File.ReadAllText(args[0],Encoding.UTF8));
   if(Payload==null||String.IsNullOrEmpty(Payload.token)||!Path.IsPathRooted(Payload.target))throw new IOException("Invalid update payload");
   backup=Payload.target+".previous.exe";incoming=Payload.target+".update-new";
   Log("helper booted");File.WriteAllText(Payload.ready,Payload.token,Utf8);
   var deadline=DateTime.UtcNow.AddSeconds(40);
   while(DateTime.UtcNow<deadline) {
    if(File.Exists(Payload.cancel))throw new IOException("Update handoff cancelled");
    if(File.Exists(Payload.commit)) {
     try { if(File.ReadAllText(Payload.commit).Trim()==Payload.token){committed=true;break;} } catch(IOException) {}
    }
    Thread.Sleep(100);
   }
   if(!committed)throw new IOException("No client commit; no files replaced");
   Log("commit received; waiting for client exit");
   Process parent=null;
   try { parent=Process.GetProcessById(Payload.pid); } catch(ArgumentException) {}
   if(parent!=null)using(parent) { if(!parent.WaitForExit(60000))throw new IOException("Client did not exit; update cancelled"); }
   exited=true;Log("client exited; revalidating download");
   if(Hash(Payload.source)!=Payload.hash)throw new IOException("Downloaded update checksum mismatch");
   File.Copy(Payload.source,incoming,true);
   if(Hash(incoming)!=Payload.hash)throw new IOException("Staged update checksum mismatch");
   deadline=DateTime.UtcNow.AddSeconds(60);
   while(true) {
    try { File.Replace(incoming,Payload.target,backup,true);replaced=true;break; }
    catch(IOException){if(DateTime.UtcNow>=deadline)throw;Thread.Sleep(500);}
    catch(UnauthorizedAccessException){if(DateTime.UtcNow>=deadline)throw;Thread.Sleep(500);}
   }
   Log("replacement complete");Result("installed","Update installed; previous EXE retained.",backup);StartClient();Log("client launch requested");return 0;
  } catch(Exception error) {
   if(Payload==null)return 3;
   string message=error.Message;Log(message);
   if(replaced) {
    try { File.Replace(backup,Payload.target,Payload.target+".failed-update.exe",true);replaced=false;Log("rolled back"); }
    catch(Exception rollback) { message+="; rollback failed: "+rollback.Message;Log(message); }
   }
   if(committed) { try { Result("failed",message,backup); } catch {} }
   if(exited&&!replaced) { try { StartClient(); } catch(Exception restart){Log("Old client restart failed: "+restart.Message);} }
   return 1;
  } finally {
   if(incoming!=null)Clean(incoming);
   if(exited&&Payload!=null){Clean(Payload.source);Clean(Payload.ready);Clean(args[0]);}
  }
 }
}
