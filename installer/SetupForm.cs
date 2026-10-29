using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using Drift;

namespace DriftSetup;

/// <summary>
/// The installer window, drawn in Drift's style: one small card that goes from "Install" to progress to "Open Drift".
/// The same window handles uninstalling.
/// </summary>
class SetupForm : Form
{
    enum Step { Ready, Working, Done, Failed, ConfirmRemove, Removed }

    readonly bool uninstall, dark;
    readonly Color bg, fg, muted, faint, line, accent, accentText, hover, danger;
    readonly Font titleFont, bodyFont, smallFont, buttonFont;
    readonly System.Windows.Forms.Timer anim = new() { Interval = 15 };
    readonly string dir;
    Step step;
    bool desktop = true, removeData;
    double progress, shownProgress;
    string status = "", error;
    string hot;
    readonly Dictionary<string, Rectangle> hits = new();
    Image logo;

    public SetupForm(bool uninstall)
    {
        this.uninstall = uninstall;
        dir = uninstall ? (Installer.InstalledDir() ?? Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location)) : (Installer.InstalledDir() ?? Installer.DefaultDir);
        step = uninstall ? Step.ConfirmRemove : Step.Ready;

        dark = PrefersDark();
        bg = dark ? Color.FromArgb(28, 29, 33) : Color.FromArgb(250, 250, 251);
        fg = dark ? Color.FromArgb(236, 236, 239) : Color.FromArgb(23, 25, 29);
        muted = dark ? Color.FromArgb(162, 166, 173) : Color.FromArgb(96, 102, 112);
        faint = dark ? Color.FromArgb(110, 115, 123) : Color.FromArgb(154, 160, 169);
        line = dark ? Color.FromArgb(52, 54, 60) : Color.FromArgb(226, 228, 232);
        hover = dark ? Color.FromArgb(44, 46, 51) : Color.FromArgb(238, 240, 243);
        accent = dark ? Color.FromArgb(53, 201, 177) : Color.FromArgb(13, 154, 135);
        accentText = dark ? Color.FromArgb(10, 30, 27) : Color.White;
        danger = Color.FromArgb(229, 72, 77);

        var family = FontFamily.Families.Any(f => f.Name == "Segoe UI Variable Display") ? "Segoe UI Variable Display" : "Segoe UI";
        var text = FontFamily.Families.Any(f => f.Name == "Segoe UI Variable Text") ? "Segoe UI Variable Text" : "Segoe UI";
        titleFont = new Font(family, 17f, FontStyle.Bold);
        bodyFont = new Font(text, 9.75f);
        smallFont = new Font(text, 8.5f);
        buttonFont = new Font(text, 9.75f, FontStyle.Bold);

        Text = uninstall ? "Uninstall Drift" : "Drift Setup";
        Icon = AppIcon.Create();
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.None;
        DoubleBuffered = true;
        BackColor = bg;
        ClientSize = new Size(Px(460), Px(330));
        logo = Logo(Px(64));

        anim.Tick += (_, _) =>
        {
            shownProgress += (progress - shownProgress) * 0.2;
            if (Math.Abs(progress - shownProgress) < 0.002) shownProgress = progress;
            Invalidate();
        };
        anim.Start();
    }

    // The installer is a single .exe (no .config file), so WinForms doesn't know the display scale; ask Windows.
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint GetDpiForSystem();
    static readonly float Scale = SystemScale();
    static float SystemScale()
    {
        try { return GetDpiForSystem() / 96f; }
        catch { using var g = Graphics.FromHwnd(IntPtr.Zero); return g.DpiX / 96f; }
    }
    int Px(float v) => (int)Math.Round(v * Scale);

    static bool PrefersDark()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return key?.GetValue("AppsUseLightTheme") is int v && v == 0;
        }
        catch { return false; }
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.StyleFrame(Handle, line, dark);
    }

    static Image Logo(int size)
    {
        var bmp = new Bitmap(size, size);
        using var g = Graphics.FromImage(bmp);
        g.SmoothingMode = SmoothingMode.AntiAlias;
        float s = size / 64f;
        g.ScaleTransform(s, s);
        var r = new Rectangle(2, 2, 60, 60);
        using var path = Rounded(r, 17);
        using var fill = new LinearGradientBrush(r, Color.FromArgb(36, 196, 170), Color.FromArgb(28, 104, 214), 45f);
        g.FillPath(fill, path);
        using var pen = new Pen(Color.White, 6f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawBezier(pen, 14, 38, 24, 22, 34, 46, 50, 26);
        using var pen2 = new Pen(Color.FromArgb(150, 255, 255, 255), 4f) { StartCap = LineCap.Round, EndCap = LineCap.Round };
        g.DrawBezier(pen2, 16, 48, 26, 36, 36, 54, 48, 40);
        return bmp;
    }

    static GraphicsPath Rounded(RectangleF r, float radius)
    {
        var p = new GraphicsPath();
        float d = radius * 2;
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    // ---------------- drawing ----------------

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
        hits.Clear();
        int pad = Px(32), w = ClientSize.Width;

        // close button
        var close = new Rectangle(w - Px(46), 0, Px(46), Px(36));
        hits["close"] = close;
        if (hot == "close") using (var b = new SolidBrush(Color.FromArgb(196, 43, 28))) g.FillRectangle(b, close);
        using (var f = new Font("Segoe MDL2 Assets", 7.5f))
            TextRenderer.DrawText(g, "", f, close, hot == "close" ? Color.White : muted, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter);

        g.DrawImage(logo, pad, Px(36), Px(64), Px(64));

        string title, sub;
        switch (step)
        {
            case Step.Ready:
                var installed = Installer.InstalledVersion();
                title = installed == null ? "Install Drift" : installed == Installer.Version ? "Reinstall Drift" : "Update Drift";
                sub = installed == null ? $"Version {Installer.Version} · a calm, fast browser for Windows"
                                        : $"Version {installed} is installed. This installs {Installer.Version}.";
                break;
            case Step.Working: title = uninstall ? "Removing Drift…" : "Installing Drift…"; sub = status; break;
            case Step.Done: title = "Drift is ready"; sub = "It's in your Start menu" + (desktop ? " and on your desktop." : "."); break;
            case Step.Failed: title = "Something went wrong"; sub = error; break;
            case Step.ConfirmRemove: title = "Uninstall Drift?"; sub = "Drift will be removed from this PC."; break;
            default: title = "Drift was removed"; sub = removeData ? "Your browsing data was deleted too." : "Your history and settings are still there if you install it again."; break;
        }
        int tx = pad + Px(64) + Px(18), tw = w - tx - pad;
        TextRenderer.DrawText(g, title, titleFont, new Rectangle(tx, Px(40), tw, titleFont.Height + Px(4)), fg, TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis);
        TextRenderer.DrawText(g, sub ?? "", bodyFont, new Rectangle(tx, Px(44) + titleFont.Height, tw, Px(44)), step == Step.Failed ? danger : muted,
            TextFormatFlags.NoPrefix | TextFormatFlags.WordBreak | TextFormatFlags.EndEllipsis);

        int y = Px(132);
        if (step == Step.Ready)
        {
            DrawField(g, new Rectangle(pad, y, w - pad * 2, Px(52)), "Installs to", ShortPath(dir));
            y += Px(68);
            DrawCheck(g, "desktop", new Rectangle(pad, y, w - pad * 2, Px(28)), "Add a shortcut to the desktop", desktop);
        }
        else if (step == Step.ConfirmRemove)
        {
            DrawField(g, new Rectangle(pad, y, w - pad * 2, Px(52)), "Installed in", ShortPath(dir));
            y += Px(68);
            DrawCheck(g, "data", new Rectangle(pad, y, w - pad * 2, Px(28)), "Also delete my history, settings and saved sites", removeData);
        }
        else if (step == Step.Working)
        {
            var bar = new RectangleF(pad, y + Px(30), w - pad * 2, Px(6));
            using (var b = new SolidBrush(hover)) using (var p = Rounded(bar, bar.Height / 2)) g.FillPath(b, p);
            var fillW = Math.Max(bar.Height, (float)(bar.Width * shownProgress));
            using (var b = new SolidBrush(accent)) using (var p = Rounded(new RectangleF(bar.X, bar.Y, fillW, bar.Height), bar.Height / 2)) g.FillPath(b, p);
            TextRenderer.DrawText(g, $"{Math.Round(shownProgress * 100)}%", smallFont, new Rectangle(pad, (int)bar.Bottom + Px(8), w - pad * 2, Px(20)), faint, TextFormatFlags.Right);
        }

        // buttons
        int by = ClientSize.Height - Px(32) - Px(38);
        switch (step)
        {
            case Step.Ready:
                Button(g, "primary", new Rectangle(w - pad - Px(120), by, Px(120), Px(38)), Installer.InstalledVersion() == null ? "Install" : "Update", true);
                Button(g, "cancel", new Rectangle(w - pad - Px(120) - Px(10) - Px(96), by, Px(96), Px(38)), "Cancel", false);
                break;
            case Step.ConfirmRemove:
                Button(g, "remove", new Rectangle(w - pad - Px(120), by, Px(120), Px(38)), "Uninstall", true, danger);
                Button(g, "cancel", new Rectangle(w - pad - Px(120) - Px(10) - Px(96), by, Px(96), Px(38)), "Cancel", false);
                break;
            case Step.Done:
                Button(g, "open", new Rectangle(w - pad - Px(130), by, Px(130), Px(38)), "Open Drift", true);
                Button(g, "cancel", new Rectangle(w - pad - Px(130) - Px(10) - Px(90), by, Px(90), Px(38)), "Close", false);
                break;
            case Step.Failed:
            case Step.Removed:
                Button(g, "cancel", new Rectangle(w - pad - Px(100), by, Px(100), Px(38)), "Close", step == Step.Removed);
                break;
        }
    }

    string ShortPath(string path)
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return path.StartsWith(home, StringComparison.OrdinalIgnoreCase) ? "%USERPROFILE%" + path.Substring(home.Length) : path;
    }

    void DrawField(Graphics g, Rectangle r, string label, string value)
    {
        using (var b = new SolidBrush(hover)) using (var p = Rounded(r, Px(10))) g.FillPath(b, p);
        TextRenderer.DrawText(g, label, smallFont, new Rectangle(r.X + Px(14), r.Y + Px(8), r.Width - Px(28), smallFont.Height), faint, TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(g, value, bodyFont, new Rectangle(r.X + Px(14), r.Y + Px(9) + smallFont.Height, r.Width - Px(28), bodyFont.Height + Px(2)), fg,
            TextFormatFlags.NoPrefix | TextFormatFlags.PathEllipsis);
    }

    void DrawCheck(Graphics g, string id, Rectangle r, string label, bool on)
    {
        hits[id] = r;
        var box = new RectangleF(r.X + 1, r.Y + (r.Height - Px(18)) / 2f, Px(18), Px(18));
        using (var p = Rounded(box, Px(5)))
        {
            if (on) using (var b = new SolidBrush(accent)) g.FillPath(b, p);
            else using (var pen = new Pen(hot == id ? muted : faint, Px(1) * 1.3f)) g.DrawPath(pen, p);
        }
        if (on)
            using (var pen = new Pen(accentText, Px(1) * 1.8f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                g.DrawLines(pen, new[] { new PointF(box.X + box.Width * 0.27f, box.Y + box.Height * 0.52f), new PointF(box.X + box.Width * 0.44f, box.Y + box.Height * 0.68f), new PointF(box.X + box.Width * 0.74f, box.Y + box.Height * 0.34f) });
        TextRenderer.DrawText(g, label, bodyFont, new Rectangle(r.X + Px(28), r.Y, r.Width - Px(28), r.Height), fg, TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
    }

    void Button(Graphics g, string id, Rectangle r, string label, bool primary, Color? color = null)
    {
        hits[id] = r;
        var c = color ?? accent;
        var fill = primary ? (hot == id ? ControlPaint.Light(c, 0.12f) : c) : (hot == id ? line : hover);
        using (var b = new SolidBrush(fill)) using (var p = Rounded(r, Px(9))) g.FillPath(b, p);
        TextRenderer.DrawText(g, label, buttonFont, r, primary ? (color != null ? Color.White : accentText) : fg, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
    }

    // ---------------- input ----------------

    string HitAt(Point p) => hits.FirstOrDefault(h => h.Value.Contains(p)).Key;

    protected override void OnMouseMove(MouseEventArgs e)
    {
        var h = HitAt(e.Location);
        if (h != hot) { hot = h; Cursor = h != null ? Cursors.Hand : Cursors.Default; Invalidate(); }
        base.OnMouseMove(e);
    }

    protected override void OnMouseLeave(EventArgs e) { hot = null; Invalidate(); base.OnMouseLeave(e); }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        base.OnMouseDown(e);
        if (e.Button == MouseButtons.Left && HitAt(e.Location) == null)
        {
            Native.ReleaseCapture();   // drag the window from anywhere empty
            Native.SendMessage(Handle, Native.WM_NCLBUTTONDOWN, (IntPtr)Native.HTCAPTION, IntPtr.Zero);
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        base.OnMouseUp(e);
        if (e.Button != MouseButtons.Left) return;
        switch (HitAt(e.Location))
        {
            case "close": case "cancel": if (step != Step.Working) Close(); break;
            case "desktop": desktop = !desktop; Invalidate(); break;
            case "data": removeData = !removeData; Invalidate(); break;
            case "primary": _ = Run(install: true); break;
            case "remove": _ = Run(install: false); break;
            case "open":
                try { Process.Start(new ProcessStartInfo(Path.Combine(dir, "Drift.exe")) { UseShellExecute = true, WorkingDirectory = dir }); } catch { }
                Close();
                break;
        }
    }

    protected override bool ProcessCmdKey(ref Message msg, Keys key)
    {
        if (key == Keys.Escape && step != Step.Working) { Close(); return true; }
        if (key == Keys.Enter)
        {
            if (step == Step.Ready) _ = Run(true);
            else if (step == Step.Done || step == Step.Removed) Close();
            return true;
        }
        return base.ProcessCmdKey(ref msg, key);
    }

    // ---------------- work ----------------

    async Task Run(bool install)
    {
        if (step == Step.Working) return;
        // Drift has to be closed so its files can be replaced
        var running = Installer.RunningIn(dir);
        if (running.Count > 0)
        {
            var answer = MessageBox.Show(this, "Drift is open. Close it to continue?\n\nYour tabs will be there when you open it again.", Text,
                MessageBoxButtons.OKCancel, MessageBoxIcon.Information);
            if (answer != DialogResult.OK) { running.ForEach(p => p.Dispose()); return; }
            foreach (var p in running) using (p) { try { p.CloseMainWindow(); p.WaitForExit(8000); } catch { } }
            if (Installer.RunningIn(dir).Count > 0) { Fail("Drift is still open. Close it and try again."); return; }
        }

        step = Step.Working;
        progress = shownProgress = 0;
        status = install ? "Getting ready…" : "Removing files…";
        Invalidate();
        try
        {
            if (install)
            {
                var d = dir; bool desk = desktop;
                await Task.Run(() => Installer.Install(d, desk, (p, s) => BeginInvoke(new Action(() => { progress = p; status = s; }))));
                await Task.Delay(350);
                step = Step.Done;
            }
            else
            {
                progress = 0.5;
                var d = dir; bool data = removeData;
                await Task.Run(() => Installer.Uninstall(d, data));
                progress = 1;
                await Task.Delay(300);
                step = Step.Removed;
            }
        }
        catch (Exception ex) { Fail(ex.Message); return; }
        Invalidate();
    }

    void Fail(string message)
    {
        step = Step.Failed;
        error = message;
        Invalidate();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) { anim.Dispose(); titleFont.Dispose(); bodyFont.Dispose(); smallFont.Dispose(); buttonFont.Dispose(); logo?.Dispose(); }
        base.Dispose(disposing);
    }
}
