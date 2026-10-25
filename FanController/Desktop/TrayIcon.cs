using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using FanController.Control;

namespace FanController.Desktop;

/// <summary>Icon next to the clock: open the interface, switch profile, quit.</summary>
public sealed class TrayIcon
{
    private readonly string _url;
    private readonly ControlLoop _loop;
    private readonly Action _quit;
    private NotifyIcon? _icon;
    private Icon? _normal, _alert;
    private ApplicationContext? _context;

    public TrayIcon(string url, ControlLoop loop, Action quit)
    {
        _url = url;
        _loop = loop;
        _quit = quit;
    }

    public void Start()
    {
        var thread = new Thread(Run) { IsBackground = true, Name = "Tray" };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
    }

    public void Close() => _context?.ExitThread();

    public static void OpenBrowser(string url)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
    }

    private void Run()
    {
        _normal = DrawIcon(Color.WhiteSmoke);
        _alert = DrawIcon(Color.FromArgb(255, 107, 91));
        var menu = new ContextMenuStrip();
        menu.Opening += (_, _) => BuildMenu(menu);
        BuildMenu(menu);

        _icon = new NotifyIcon { Icon = _normal, Text = "EZFAN", ContextMenuStrip = menu, Visible = true };
        _icon.MouseDoubleClick += (_, _) => OpenBrowser(_url);

        // Turns the icon red and tells the user when the safety kicks in.
        var timer = new System.Windows.Forms.Timer { Interval = 2000 };
        var wasAlert = false;
        timer.Tick += (_, _) =>
        {
            var alert = _loop.SafetyActive;
            _icon.Icon = alert ? _alert : _normal;
            _icon.Text = alert ? "EZFAN : sécurité active !" : $"EZFAN : {_loop.Config.ActiveProfile}";
            if (alert && !wasAlert)
                _icon.ShowBalloonTip(5000, "Température critique", "Tous les ventilos pilotés passent à 100 %.", ToolTipIcon.Warning);
            wasAlert = alert;
        };
        timer.Start();

        _context = new ApplicationContext();
        Application.Run(_context);
        timer.Dispose();
        _icon.Visible = false;
        _icon.Dispose();
    }

    private void BuildMenu(ContextMenuStrip menu)
    {
        menu.Items.Clear();
        var open = new ToolStripMenuItem("Ouvrir l'interface", null, (_, _) => OpenBrowser(_url)) { Font = new Font(menu.Font, FontStyle.Bold) };
        menu.Items.Add(open);
        menu.Items.Add(new ToolStripSeparator());

        var config = _loop.Config;
        foreach (var name in config.Profiles.Keys)
        {
            var item = new ToolStripMenuItem(name, null, (_, _) =>
            {
                var c = _loop.Config;
                c.ActiveProfile = name;
                _loop.Update(c);
            }) { Checked = name == config.ActiveProfile };
            menu.Items.Add(item);
        }

        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Quitter (ventilos rendus au BIOS)", null, (_, _) => _quit()));
    }

    private static Icon DrawIcon(Color color)
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var pen = new Pen(color, 2.5f);
            using var brush = new SolidBrush(color);
            g.DrawEllipse(pen, 2, 2, 28, 28);
            for (var i = 0; i < 4; i++)
            {
                var state = g.Save();
                g.TranslateTransform(16, 16);
                g.RotateTransform(i * 90);
                g.FillEllipse(brush, -3, -13, 9, 12);
                g.Restore(state);
            }
            g.FillEllipse(Brushes.Black, 12, 12, 8, 8);
            g.FillEllipse(brush, 14, 14, 4, 4);
        }
        return Icon.FromHandle(bmp.GetHicon());
    }
}
