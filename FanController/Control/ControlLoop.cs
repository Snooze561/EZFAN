using System.Text.Json;
using FanController.Hardware;

namespace FanController.Control;

public record FanRuntime(string ControlId, float? Target, float? Applied, string Reason);

public record CurveRuntime(string CurveId, float? Temp, float? Output);

/// <summary>
/// Once a second: refresh the sensors, evaluate every curve, smooth the result and drive the fans.
/// </summary>
public sealed class ControlLoop : IDisposable
{
    private const double TickSeconds = 1.0;

    private readonly HardwareService _hw;
    private readonly object _lock = new();
    private readonly Timer _timer;
    private AppConfig _config;

    // Per curve: the temperature currently used, kept still inside the hysteresis band.
    private readonly Dictionary<string, float> _curveTemp = [];
    // Per fan: the % last sent, so the ramp starts from where the fan really is.
    private readonly Dictionary<string, float> _applied = [];
    private readonly HashSet<string> _managed = [];
    private int _tick;

    public ControlLoop(HardwareService hw)
    {
        _hw = hw;
        var saved = ConfigStore.Load();
        if (saved != null) Defaults.Migrate(saved, hw.Current);
        _config = saved ?? Defaults.Build(hw.Current);
        ConfigStore.Save(_config);
        _timer = new Timer(_ => Tick(), null, 0, (int)(TickSeconds * 1000));
    }

    public bool SafetyActive { get; private set; }
    public IReadOnlyList<FanRuntime> Fans { get; private set; } = [];
    public IReadOnlyList<CurveRuntime> Curves { get; private set; } = [];

    public AppConfig Config
    {
        get { lock (_lock) return Clone(_config); }
    }

    public void Update(AppConfig config)
    {
        if (config.Profiles.Count == 0) throw new ArgumentException("Il faut au moins un profil.");
        if (!config.Profiles.ContainsKey(config.ActiveProfile)) config.ActiveProfile = config.Profiles.Keys.First();
        foreach (var curve in config.Profiles.Values.SelectMany(p => p.Curves))
            curve.Points = curve.Points.OrderBy(p => p.Temp).ToList();

        lock (_lock)
        {
            _config = Clone(config);
            _curveTemp.Clear();
        }
        ConfigStore.Save(config);
    }

    /// <summary>Applies the wizard's answers and replaces the profiles by the four usage profiles.</summary>
    public void FinishSetup(AppConfig answers, string activeProfile)
    {
        answers.Profiles = Defaults.BuildProfiles(answers, _hw.Current);
        answers.ActiveProfile = answers.Profiles.ContainsKey(activeProfile) ? activeProfile : Defaults.ProfileNames[0];
        answers.SetupDone = true;
        Update(answers);
    }

    private string? _identifyId;
    private DateTime _identifyUntil;

    /// <summary>Spins one header at full speed and slows every other one, so the user can see which fan it is.</summary>
    public void Identify(string? controlId, int seconds)
    {
        lock (_lock)
        {
            _identifyId = controlId;
            _identifyUntil = DateTime.Now.AddSeconds(Math.Clamp(seconds, 1, 30));
        }
    }

    public string? Identifying => DateTime.Now < _identifyUntil ? _identifyId : null;

    public static float? Evaluate(Curve curve, float temp)
    {
        var pts = curve.Points;
        if (pts.Count == 0) return null;
        if (temp <= pts[0].Temp) return pts[0].Percent;
        if (temp >= pts[^1].Temp) return pts[^1].Percent;
        for (var i = 1; i < pts.Count; i++)
        {
            if (temp > pts[i].Temp) continue;
            var a = pts[i - 1];
            var b = pts[i];
            var k = (temp - a.Temp) / Math.Max(b.Temp - a.Temp, 0.001f);
            return a.Percent + k * (b.Percent - a.Percent);
        }
        return pts[^1].Percent;
    }

    private void Tick()
    {
        try
        {
            _hw.Refresh();
            lock (_lock) Apply();
        }
        catch (Exception e)
        {
            Console.WriteLine($"Erreur de régulation : {e.Message}");
        }
    }

    private void Apply()
    {
        _tick++;
        var profile = _config.Active;
        var safety = _config.Safety;

        var cpu = _hw.Temperature(safety.CpuSensorId);
        var gpu = _hw.Temperature(safety.GpuSensorId);
        SafetyActive = cpu >= safety.CriticalCpu || gpu >= safety.CriticalGpu;

        var curves = new List<CurveRuntime>();
        var curveOut = new Dictionary<string, (float? output, Curve curve)>();
        foreach (var curve in profile.Curves)
        {
            var temp = _hw.Temperature(curve.SensorId);
            float? output = null;
            if (temp is float t)
            {
                // Follow the temperature up at once, but only follow it down past the hysteresis band.
                var used = _curveTemp.TryGetValue(curve.Id, out var prev) && t < prev && t > prev - curve.Hysteresis
                    ? prev
                    : t;
                _curveTemp[curve.Id] = used;
                output = Evaluate(curve, used);
            }
            curveOut[curve.Id] = (output, curve);
            curves.Add(new CurveRuntime(curve.Id, temp, output));
        }

        var fans = new List<FanRuntime>();
        if (!SafetyActive && Identifying is string testing)
        {
            // Graphics card fans are left alone unless they are the one being tested.
            foreach (var c in _hw.Current.Controls.Where(c => c.Id == testing || !c.Id.StartsWith("/gpu")))
            {
                var pct = c.Id == testing ? 100f : 25f;
                _hw.SetPercent(c.Id, pct);
                _applied[c.Id] = pct;
                _managed.Add(c.Id);
                fans.Add(new FanRuntime(c.Id, pct, pct, c.Id == testing ? "Test : à fond" : "Test : ralenti"));
            }
            Fans = fans;
            Curves = curves;
            return;
        }

        foreach (var fan in profile.Fans)
        {
            float? target;
            string reason;
            Curve? curve = null;

            if (fan.Mode == FanMode.Bios)
            {
                if (_managed.Remove(fan.ControlId))
                {
                    _hw.SetDefault(fan.ControlId);
                    _applied.Remove(fan.ControlId);
                }
                fans.Add(new FanRuntime(fan.ControlId, null, null, "BIOS"));
                continue;
            }

            if (SafetyActive)
            {
                target = 100;
                reason = "Sécurité : température critique";
            }
            else if (fan.Mode == FanMode.Fixed)
            {
                target = fan.FixedPercent;
                reason = "Vitesse fixe";
            }
            else if (fan.CurveId != null && curveOut.TryGetValue(fan.CurveId, out var c))
            {
                curve = c.curve;
                // A sensor that stops answering must never leave the fans slow.
                target = c.output ?? 100;
                reason = c.output == null ? "Sonde muette : 100 % par sécurité" : $"Courbe « {c.curve.Name} »";
            }
            else
            {
                target = 100;
                reason = "Courbe introuvable : 100 % par sécurité";
            }

            var current = _applied.TryGetValue(fan.ControlId, out var a) ? a : CurrentPercent(fan.ControlId) ?? target.Value;
            var next = target.Value;
            if (!SafetyActive && fan.Mode == FanMode.Curve && curve != null)
            {
                var up = (float)(curve.RampUp * TickSeconds);
                var down = (float)(curve.RampDown * TickSeconds);
                next = Math.Clamp(target.Value, current - down, current + up);
            }

            // Re-send every 10 s even without change, some boards drift back to their own curve.
            if (!_applied.ContainsKey(fan.ControlId) || Math.Abs(next - current) >= 0.5f || _tick % 10 == 0)
                _hw.SetPercent(fan.ControlId, next);
            _applied[fan.ControlId] = next;
            _managed.Add(fan.ControlId);
            fans.Add(new FanRuntime(fan.ControlId, target, next, reason));
        }

        Fans = fans;
        Curves = curves;
    }

    private float? CurrentPercent(string controlId) =>
        _hw.Current.Controls.FirstOrDefault(c => c.Id == controlId)?.Percent;

    private static AppConfig Clone(AppConfig c) =>
        JsonSerializer.Deserialize<AppConfig>(JsonSerializer.Serialize(c, ConfigStore.Json), ConfigStore.Json)!;

    public void Dispose()
    {
        _timer.Dispose();
        lock (_lock) _managed.Clear();
    }
}
