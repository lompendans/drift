namespace DriftSetup;

static class Program
{
    // DriftSetup.exe                      install (or update) with the setup window
    // DriftSetup.exe /silent [/desktop]   install with no window
    // DriftSetup.exe /update /dir="…" /wait=<pid> [/relaunch]   what Drift's updater runs
    // "Uninstall Drift.exe" /uninstall [/silent]
    [STAThread]
    static int Main(string[] args)
    {
        string Arg(string name) => args.FirstOrDefault(a => a.StartsWith("/" + name + "=", StringComparison.OrdinalIgnoreCase))?.Substring(name.Length + 2).Trim('"');
        bool Flag(string name) => args.Any(a => a.Equals("/" + name, StringComparison.OrdinalIgnoreCase));

        if (Flag("update"))
        {
            var dir = Arg("dir");
            if (string.IsNullOrEmpty(dir) || !File.Exists(Path.Combine(dir, "Drift.exe"))) return 2;   // only update a real Drift folder
            int.TryParse(Arg("wait"), out var pid);
            return Installer.Update(dir, pid, Flag("relaunch"));
        }
        if (Flag("silent"))
        {
            try
            {
                if (Flag("uninstall")) Installer.Uninstall(Installer.InstalledDir() ?? Installer.DefaultDir, Flag("removedata"));
                else Installer.Install(Installer.InstalledDir() ?? Installer.DefaultDir, Flag("desktop"), (_, _) => { });
                return 0;
            }
            catch { return 1; }
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new SetupForm(uninstall: Flag("uninstall")));
        return 0;
    }
}
