using System.Diagnostics;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace DriftSetup;

/// <summary>Installs, updates and removes Drift for the current user (no administrator rights needed).</summary>
static class Installer
{
    public const string AppName = "Drift";
    public const string Site = "https://lompendans.github.io/drift/";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\Drift";

    public static string Version => downloadedVersion ?? (Assembly.GetExecutingAssembly().GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "1.0.0");

    /// <summary>The online installer: Drift's files aren't inside it, so it downloads the newest release while installing.</summary>
    public static bool Online => Assembly.GetExecutingAssembly().GetManifestResourceInfo("payload.zip") == null;
    const string LatestApi = "https://api.github.com/repos/lompendans/drift/releases/latest";
    const string PortableZip = "Drift-portable.zip";
    static string downloadedVersion;
    public static string DefaultDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Drift");
    static string StartMenuLink => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Drift.lnk");
    static string DesktopLink => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Drift.lnk");

    /// <summary>The version installed now, or null.</summary>
    public static string InstalledVersion()
    {
        using var key = Registry.CurrentUser.OpenSubKey(UninstallKey);
        return key?.GetValue("DisplayVersion") as string;
    }

    public static string InstalledDir()
    {
        using var key = Registry.CurrentUser.OpenSubKey(UninstallKey);
        return key?.GetValue("InstallLocation") as string;
    }

    // Drift 1.x (built on WebView2) kept these next to Drift.exe; 2.0 brings its own engine and doesn't use them.
    static readonly string[] OldFiles =
    {
        "Drift.exe.config", "Drift.pdb", "Microsoft.Bcl.AsyncInterfaces.dll", "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll",
        "Microsoft.Web.WebView2.Wpf.dll", "System.Buffers.dll", "System.Memory.dll", "System.Numerics.Vectors.dll", "System.Runtime.CompilerServices.Unsafe.dll",
        "System.Text.Encodings.Web.dll", "System.Text.Json.dll", "System.Threading.Tasks.Extensions.dll", "System.ValueTuple.dll",
    };
    static readonly string[] OldFolders = { "ui", "pages", "runtimes" };

    static void RemoveOldVersion(string dir)
    {
        foreach (var f in OldFiles) try { var p = Path.Combine(dir, f); if (File.Exists(p)) File.Delete(p); } catch { }
        foreach (var d in OldFolders) try { var p = Path.Combine(dir, d); if (Directory.Exists(p)) Directory.Delete(p, true); } catch { }
    }

    /// <summary>Drift windows running from <paramref name="dir"/>.</summary>
    public static List<Process> RunningIn(string dir)
    {
        var list = new List<Process>();
        foreach (var p in Process.GetProcessesByName("Drift"))
        {
            try
            {
                var file = p.MainModule?.FileName;
                if (file != null && string.Equals(Path.GetDirectoryName(file).TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) list.Add(p);
                else p.Dispose();
            }
            catch { p.Dispose(); }
        }
        return list;
    }

    /// <summary>
    /// Downloads the newest release's portable zip to a temporary file and checks it against the SHA-256 checksum GitHub
    /// publishes for it. Reports progress 0–1. Returns the file's path.
    /// </summary>
    public static string Download(Action<double> progress)
    {
        ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
        string release;
        using (var web = new WebClient())
        {
            web.Headers[HttpRequestHeader.UserAgent] = "DriftSetup/" + Version;
            web.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
            try { release = web.DownloadString(LatestApi); }
            catch (WebException) { throw new IOException("Couldn't reach GitHub. Check your internet connection and try again."); }
        }
        // the asset's object lists its name, then its download address and checksum
        var asset = Regex.Match(release, "\"name\"\\s*:\\s*\"" + Regex.Escape(PortableZip) + "\"(?:(?!\"name\"\\s*:).)*", RegexOptions.Singleline).Value;
        var url = Regex.Match(asset, "\"browser_download_url\"\\s*:\\s*\"([^\"]+)\"").Groups[1].Value;
        var sha = Regex.Match(asset, "\"digest\"\\s*:\\s*\"sha256:([0-9a-f]{64})\"").Groups[1].Value;
        if (url.Length == 0 || sha.Length == 0) throw new InvalidDataException("The newest Drift release has no Windows download yet. Try again later.");
        var tag = Regex.Match(release, "\"tag_name\"\\s*:\\s*\"v?([^\"]+)\"").Groups[1].Value;

        var file = Path.Combine(Path.GetTempPath(), "Drift-setup-" + Guid.NewGuid().ToString("N") + ".zip");
        try
        {
            var request = (HttpWebRequest)WebRequest.Create(url);
            request.UserAgent = "DriftSetup/" + Version;
            using (var response = request.GetResponse())
            using (var input = response.GetResponseStream())
            using (var output = File.Create(file))
            using (var hash = SHA256.Create())
            {
                long total = response.ContentLength, done = 0;
                var buffer = new byte[81920];
                for (int n; (n = input.Read(buffer, 0, buffer.Length)) > 0;)
                {
                    output.Write(buffer, 0, n);
                    hash.TransformBlock(buffer, 0, n, null, 0);
                    done += n;
                    if (total > 0) progress?.Invoke(Math.Min(1, done / (double)total));
                }
                hash.TransformFinalBlock(buffer, 0, 0);
                if (!BitConverter.ToString(hash.Hash).Replace("-", "").Equals(sha, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidDataException("The download was damaged on the way. Try again.");
            }
            if (tag.Length > 0) downloadedVersion = tag;
            return file;
        }
        catch (WebException) { try { File.Delete(file); } catch { } throw new IOException("The download stopped. Check your internet connection and try again."); }
        catch { try { File.Delete(file); } catch { } throw; }
    }

    /// <summary>
    /// Copies Drift's files into <paramref name="dir"/>, replacing what's there: from inside this installer, or from a
    /// downloaded portable zip (which keeps them in a "Drift" folder). Reports progress 0–1.
    /// </summary>
    public static void CopyFiles(string dir, Action<double> progress, string downloaded = null)
    {
        using var payload = downloaded != null ? File.OpenRead(downloaded)
                            : Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")
                              ?? throw new InvalidDataException("This installer is missing Drift's files.");
        using var zip = new ZipArchive(payload, ZipArchiveMode.Read);
        Directory.CreateDirectory(dir);
        RemoveOldVersion(dir);
        var files = zip.Entries.Where(e => e.Name.Length > 0).ToList();
        for (int i = 0; i < files.Count; i++)
        {
            var e = files[i];
            var name = downloaded != null ? e.FullName.Replace('\\', '/') : e.FullName;
            if (downloaded != null) { if (!name.StartsWith("Drift/", StringComparison.OrdinalIgnoreCase)) continue; name = name.Substring(6); }
            var target = Path.GetFullPath(Path.Combine(dir, name));
            if (!target.StartsWith(Path.GetFullPath(dir) + "\\", StringComparison.OrdinalIgnoreCase)) continue;   // stay inside the folder
            Directory.CreateDirectory(Path.GetDirectoryName(target));
            Retry(() =>
            {
                var tmp = target + ".new";
                e.ExtractToFile(tmp, true);
                if (File.Exists(target)) File.Delete(target);
                File.Move(tmp, target);
            });
            progress?.Invoke((i + 1) / (double)files.Count);
        }
    }

    // A file can stay locked for a moment after Drift exits (antivirus, the web engine shutting down).
    static void Retry(Action a)
    {
        for (int n = 0; ; n++)
        {
            try { a(); return; }
            catch (IOException) when (n < 20) { System.Threading.Thread.Sleep(250); }
            catch (UnauthorizedAccessException) when (n < 20) { System.Threading.Thread.Sleep(250); }
        }
    }

    /// <summary>Keeps a copy of this installer next to Drift; Windows runs it to uninstall.</summary>
    static void CopySelf(string dir)
    {
        var self = Assembly.GetExecutingAssembly().Location;
        var target = Path.Combine(dir, "Uninstall Drift.exe");
        if (string.Equals(Path.GetFullPath(self), Path.GetFullPath(target), StringComparison.OrdinalIgnoreCase)) return;
        Retry(() => File.Copy(self, target, true));
    }

    public static void Register(string dir)
    {
        long size = 0;
        try { size = new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length) / 1024; } catch { }
        var uninstaller = Path.Combine(dir, "Uninstall Drift.exe");
        using var key = Registry.CurrentUser.CreateSubKey(UninstallKey);
        key.SetValue("DisplayName", AppName);
        key.SetValue("DisplayVersion", Version);
        key.SetValue("Publisher", "lompendans");
        key.SetValue("DisplayIcon", Path.Combine(dir, "Drift.exe") + ",0");
        key.SetValue("InstallLocation", dir);
        key.SetValue("UninstallString", $"\"{uninstaller}\" /uninstall");
        key.SetValue("QuietUninstallString", $"\"{uninstaller}\" /uninstall /silent");
        key.SetValue("URLInfoAbout", Site);
        key.SetValue("HelpLink", Site);
        key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
        key.SetValue("EstimatedSize", (int)size, RegistryValueKind.DWord);
        key.SetValue("NoModify", 1, RegistryValueKind.DWord);
        key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
    }

    static void Shortcut(string link, string target, string description)
    {
        var shellType = Type.GetTypeFromProgID("WScript.Shell");
        var shell = Activator.CreateInstance(shellType);
        try
        {
            var sc = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
            var t = sc.GetType();
            t.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            t.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Path.GetDirectoryName(target) });
            t.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { description });
            t.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
            t.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(sc);
        }
        finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); }
    }

    /// <summary>A full install: files, uninstaller, Start menu (and desktop) shortcut, and the entry in Windows' app list.</summary>
    public static void Install(string dir, bool desktopShortcut, Action<double, string> progress)
    {
        string downloaded = null;
        try
        {
            if (Online)
            {
                progress(0.01, "Downloading Drift…");
                downloaded = Download(p => progress(0.01 + p * 0.6, $"Downloading Drift… {p:P0}"));
                progress(0.62, "Copying Drift's files…");
                CopyFiles(dir, p => progress(0.62 + p * 0.24, "Copying Drift's files…"), downloaded);
            }
            else
            {
                progress(0.02, "Copying Drift's files…");
                CopyFiles(dir, p => progress(0.05 + p * 0.8, "Copying Drift's files…"));
            }
        }
        finally { if (downloaded != null) try { File.Delete(downloaded); } catch { } }
        progress(0.88, "Adding shortcuts…");
        CopySelf(dir);
        var exe = Path.Combine(dir, "Drift.exe");
        Shortcut(StartMenuLink, exe, "A calm, fast browser");
        if (desktopShortcut) Shortcut(DesktopLink, exe, "A calm, fast browser");
        else if (File.Exists(DesktopLink)) try { File.Delete(DesktopLink); } catch { }
        progress(0.96, "Finishing…");
        Register(dir);
        progress(1, "Done");
    }

    /// <summary>
    /// What Drift's updater runs: wait for Drift to close, put the new files where Drift is (installed or portable),
    /// and open it again if asked.
    /// </summary>
    public static int Update(string dir, int waitPid, bool relaunch)
    {
        try
        {
            if (waitPid > 0)
                try { using var p = Process.GetProcessById(waitPid); p.WaitForExit(); } catch { }
            foreach (var p in RunningIn(dir)) using (p) p.WaitForExit(30000);
            CopyFiles(dir, null);
            if (string.Equals(InstalledDir()?.TrimEnd('\\'), dir.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            {
                CopySelf(dir);
                Register(dir);
            }
            if (relaunch) Process.Start(new ProcessStartInfo(Path.Combine(dir, "Drift.exe")) { UseShellExecute = true, WorkingDirectory = dir });
            return 0;
        }
        catch (Exception ex)
        {
            try { File.AppendAllText(Path.Combine(Path.GetTempPath(), "DriftSetup.log"), $"{DateTime.Now:o} update failed: {ex}\r\n"); } catch { }
            if (relaunch) try { Process.Start(Path.Combine(dir, "Drift.exe")); } catch { }
            return 1;
        }
    }

    /// <summary>Removes Drift. Browsing data stays unless <paramref name="removeData"/> is set.</summary>
    public static void Uninstall(string dir, bool removeData)
    {
        foreach (var link in new[] { StartMenuLink, DesktopLink }) try { if (File.Exists(link)) File.Delete(link); } catch { }
        try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
        if (removeData)
        {
            foreach (var d in new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Drift"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Drift"),
            })
                try { if (Directory.Exists(d)) Directory.Delete(d, true); } catch { }
        }
        // Delete everything but this running uninstaller, then let Windows remove the folder once it exits.
        var self = Path.GetFullPath(Assembly.GetExecutingAssembly().Location);
        // Only ever remove a folder that is clearly Drift's own.
        bool safe = !string.IsNullOrEmpty(dir) && Directory.Exists(dir) && Path.GetFileName(dir.TrimEnd('\\')).Equals("Drift", StringComparison.OrdinalIgnoreCase)
                    && File.Exists(Path.Combine(dir, "Drift.exe")) && Path.GetFullPath(dir).Length > 10;
        if (safe)
        {
            foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                if (!string.Equals(Path.GetFullPath(f), self, StringComparison.OrdinalIgnoreCase)) try { File.Delete(f); } catch { }
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q \"{dir}\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                WorkingDirectory = Path.GetTempPath(),
            });
        }
    }
}
