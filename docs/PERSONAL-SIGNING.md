# 仅供自己的 Windows 使用：自签名与本机信任

可以自己签名，并让自己的 Windows 账户信任这个证书。不需要购买证书。

**但证书信任 ≠ SmartScreen 信誉**。自签名不保证消除“Windows 已保护你的电脑”，也不绕过 Smart App Control 或组织策略。

## 工具实际做什么

- 必须先提供从 GitHub Release `SHA256SUMS` 核对得到的原版 EXE 哈希，不匹配立即停止。
- 首次在 `Cert:\CurrentUser\My` 创建专用、不可导出的代码签名私钥，有效期三年。以后复用同一证书，不把私钥发给服务器或 CI。
- 创建 `*.personal.exe` 签名副本，不覆盖下载的原版 EXE。签名副本哈希与官方 SHA256 不同是正常的。
- **只有显式加 `-TrustCurrentUser` 时**，才把刚生成证书的公钥加入当前账户的 `Root` 与 `TrustedPublisher`，不修改 LocalMachine，也不需要管理员账户。
- 不关闭 SmartScreen、Defender、Smart App Control，不永久修改 PowerShell 执行策略，不自动解除下载锁定。
- 只签外层便携 EXE；不等于把里面解压出的 Electron EXE、DLL 都签名。若拦截的是内部文件，应另行分析，不保证外层签名能处理。
- 未使用在线时间戳，证书过期后需要更新个人证书并重新签名。

## 操作

从同一 Release 下载 `personal-sign.ps1`、`SHA256SUMS` 与 EXE，先阅读脚本。在该目录打开 PowerShell，把下面的版本号和哈希换成你下载版本的实际值：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\personal-sign.ps1 -ExePath .\OpenClaw-Desktop-0.3.5-win-x64.exe -ExpectedSha256 '填入SHA256SUMS中的64位哈希' -TrustCurrentUser
```

此命令的 `Bypass` 仅用于该 PowerShell 进程，不修改账户或系统执行策略。首次执行可能出现 Windows 对添加受信任证书的确认，请确认它是你刚生成的专用个人证书。

成功后用以下命令查看签名，再运行 `.personal.exe` 副本：

```powershell
Get-AuthenticodeSignature .\OpenClaw-Desktop-0.3.5-win-x64.personal.exe | Format-List Status,StatusMessage,SignerCertificate
```

应显示 `Valid`。以后新版重复执行同一签名命令即可；已信任的证书会复用，通常不必再加 `-TrustCurrentUser`。

如果只是下载文件的“打开文件—安全警告”，而不是证书链失败：在确认来源、核对哈希后，可对**这一份文件**在属性中“解除锁定”，或使用 `Unblock-File -LiteralPath '实际文件路径'`。这不是关闭系统防护，也不能替代检查 SmartScreen / Smart App Control 的具体提示。

## 撤销与私钥位置

状态目录：`%LOCALAPPDATA%\OpenClaw Desktop Signing`。其中 `.cer` 是公钥，`signer-thumbprint.txt` 是证书指纹；私钥由 Windows 证书存储保管，不在这个目录，不在 GitHub。

运行 `certmgr.msc`，根据该指纹在当前用户的“受信任的根证书颁发机构”和“受信任的发布者”删除本证书即可撤销信任。只删除这个指纹，不要删除其他证书。“个人”中的同指纹证书含私钥，只有不再需要签名时才删除；删除后不要再复用旧状态文件。

## 参考

- [微软：PowerShell 签名和自签名信任](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_signing)
- [微软：Set-AuthenticodeSignature](https://learn.microsoft.com/powershell/module/microsoft.powershell.security/set-authenticodesignature)
- [微软：SmartScreen 信誉限制](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
