using System.Diagnostics;
using FanController.Control;
using FanController.Desktop;
using FanController.Hardware;

const string Url = "http://localhost:5400";

var background = args.Contains("--background");

// A second launch (double-click while it already runs) just opens the interface.
using var instance = new Mutex(true, "EZFAN-single-instance", out var first);
if (!first)
{
    TrayIcon.OpenBrowser(Url);
    return;
}

var hardware = new HardwareService();

ControlLoop? loop = null;
void Shutdown()
{
    loop?.Dispose();
    hardware.Dispose();
}

// Whatever happens, never leave the fans stuck at a manual speed.
AppDomain.CurrentDomain.UnhandledException += (_, _) => hardware.SetAllDefault();
AppDomain.CurrentDomain.ProcessExit += (_, _) => Shutdown();

var reportPath = Path.Combine(AppContext.BaseDirectory, "rapport-materiel.txt");
try { File.WriteAllText(reportPath, hardware.Report()); } catch { }

if (args.Contains("--rapport"))
{
    hardware.Dispose();
    return;
}

loop = new ControlLoop(hardware);
Autostart.MigrateOldTask();
Autostart.RefreshPath();

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
});
builder.WebHost.UseUrls(Url);
builder.Logging.SetMinimumLevel(LogLevel.Warning);
builder.Services.AddSingleton(hardware);
builder.Services.AddSingleton(loop);
builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));

var app = builder.Build();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/state", (HardwareService hw, ControlLoop l) => new
{
    snapshot = hw.Current,
    config = l.Config,
    fans = l.Fans,
    curves = l.Curves,
    safetyActive = l.SafetyActive,
    identifying = l.Identifying,
    warnings = Warnings(hw),
});

app.MapPut("/api/config", (ControlLoop l, AppConfig config) =>
{
    try
    {
        l.Update(config);
        return Results.Ok();
    }
    catch (ArgumentException e)
    {
        return Results.BadRequest(e.Message);
    }
});

app.MapPost("/api/setup", (ControlLoop l, SetupRequest req) =>
{
    l.FinishSetup(req.Config, req.ActiveProfile);
    return Results.Ok();
});

app.MapPost("/api/identify", (ControlLoop l, IdentifyRequest req) =>
{
    l.Identify(req.ControlId, req.Seconds);
    return Results.Ok();
});

app.MapGet("/api/autostart", () => new { enabled = Autostart.IsEnabled() });
app.MapPost("/api/autostart", (AutostartRequest req) =>
{
    var ok = req.Enabled ? Autostart.Enable() : Autostart.Disable();
    return ok ? Results.Ok(new { enabled = Autostart.IsEnabled() }) : Results.Problem("Le planificateur de tâches a refusé.");
});

app.MapGet("/api/report", (HardwareService hw) => Results.Text(hw.Report()));

var tray = new TrayIcon(Url, loop, () => app.Lifetime.StopApplication());
app.Lifetime.ApplicationStarted.Register(() =>
{
    tray.Start();
    if (!background) TrayIcon.OpenBrowser(Url);
});
app.Lifetime.ApplicationStopping.Register(() =>
{
    tray.Close();
    Shutdown();
});

app.Run();

static List<string> Warnings(HardwareService hw)
{
    var list = new List<string>();
    if (!hw.Current.PawnIoInstalled)
        list.Add("Le pilote PawnIO n'est pas installé : installe-le depuis pawnio.eu puis relance l'appli.");
    if (Process.GetProcessesByName("FanControl").Length > 0)
        list.Add("Fan Control est encore ouvert : ferme-le, sinon les deux logiciels se battent pour les ventilos.");
    return list;
}

record AutostartRequest(bool Enabled);
record SetupRequest(AppConfig Config, string ActiveProfile);
record IdentifyRequest(string? ControlId, int Seconds);
