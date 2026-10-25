using LibreHardwareMonitor.Hardware;
using LibreHardwareMonitor.PawnIo;

namespace FanController.Hardware;

public record SensorInfo(string Id, string Name, string Hardware, string HardwareType, string Type, float? Value, string Unit);

public record ControlInfo(
    string Id,
    string Name,
    string Hardware,
    float? Percent,
    string Mode,
    string? PairedFanId,
    float? PairedFanRpm);

public record Snapshot(
    DateTime Time,
    bool PawnIoInstalled,
    IReadOnlyList<SensorInfo> Temperatures,
    IReadOnlyList<SensorInfo> Fans,
    IReadOnlyList<ControlInfo> Controls);

/// <summary>
/// Owns the LibreHardwareMonitor Computer. The library is not thread-safe,
/// so every access goes through <see cref="_lock"/>.
/// </summary>
public sealed class HardwareService : IDisposable
{
    private readonly Computer _computer;
    private readonly object _lock = new();
    private Snapshot _snapshot = new(DateTime.Now, false, [], [], []);
    private bool _disposed;

    public HardwareService()
    {
        _computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            IsMotherboardEnabled = true,
            IsControllerEnabled = true,
        };
        _computer.Open();
        Refresh();
    }

    public Snapshot Current => _snapshot;

    public void Refresh()
    {
        lock (_lock)
        {
            if (_disposed) return;
            var sensors = new List<(IHardware hw, ISensor s)>();
            foreach (var hw in _computer.Hardware)
                Collect(hw, sensors);

            var fans = sensors.Where(x => x.s.SensorType == SensorType.Fan).ToList();

            _snapshot = new Snapshot(
                DateTime.Now,
                SafePawnIoInstalled(),
                sensors.Where(x => x.s.SensorType == SensorType.Temperature).Select(x => ToInfo(x.hw, x.s, "°C")).ToList(),
                fans.Select(x => ToInfo(x.hw, x.s, "RPM")).ToList(),
                sensors.Where(x => x.s.SensorType == SensorType.Control).Select(x =>
                {
                    // A control and its fan tachometer usually share the hardware and the index.
                    var fan = fans.FirstOrDefault(f => f.hw == x.hw && f.s.Index == x.s.Index).s;
                    return new ControlInfo(
                        x.s.Identifier.ToString(),
                        x.s.Name,
                        x.hw.Name,
                        x.s.Value,
                        x.s.Control?.ControlMode.ToString() ?? "Aucun",
                        fan?.Identifier.ToString(),
                        fan?.Value);
                }).ToList());
        }
    }

    /// <summary>Sets a control to a fixed percentage (0-100).</summary>
    public bool SetPercent(string controlId, float percent)
    {
        lock (_lock)
        {
            var control = FindControl(controlId);
            if (control == null) return false;
            control.SetSoftware(Math.Clamp(percent, control.MinSoftwareValue, control.MaxSoftwareValue));
            return true;
        }
    }

    /// <summary>Latest reading of a temperature sensor, null if unknown or not reporting.</summary>
    public float? Temperature(string? sensorId) =>
        sensorId == null ? null : _snapshot.Temperatures.FirstOrDefault(t => t.Id == sensorId)?.Value;

    /// <summary>Gives a control back to the BIOS / firmware.</summary>
    public bool SetDefault(string controlId)
    {
        lock (_lock)
        {
            var control = FindControl(controlId);
            if (control == null) return false;
            control.SetDefault();
            return true;
        }
    }

    public void SetAllDefault()
    {
        lock (_lock)
        {
            foreach (var hw in _computer.Hardware)
                ForEachSensor(hw, s => s.Control?.SetDefault());
        }
    }

    /// <summary>Plain text dump of everything the library sees, for diagnosis.</summary>
    public string Report()
    {
        lock (_lock)
        {
            var w = new StringWriter();
            w.WriteLine($"EZFAN - rapport matériel - {DateTime.Now:yyyy-MM-dd HH:mm:ss}");
            w.WriteLine($"Windows : {Environment.OSVersion}");
            w.WriteLine($"PawnIO installé : {(SafePawnIoInstalled() ? "oui" : "NON")}");
            w.WriteLine();
            foreach (var hw in _computer.Hardware)
                WriteHardware(w, hw, 0);
            return w.ToString();
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            foreach (var hw in _computer.Hardware)
                ForEachSensor(hw, s => s.Control?.SetDefault());
            _computer.Close();
            _disposed = true;
        }
    }

    private IControl? FindControl(string controlId)
    {
        IControl? found = null;
        foreach (var hw in _computer.Hardware)
            ForEachSensor(hw, s =>
            {
                if (s.SensorType == SensorType.Control && s.Identifier.ToString() == controlId)
                    found = s.Control;
            });
        return found;
    }

    private static void Collect(IHardware hw, List<(IHardware, ISensor)> into)
    {
        hw.Update();
        foreach (var s in hw.Sensors)
            into.Add((hw, s));
        foreach (var sub in hw.SubHardware)
            Collect(sub, into);
    }

    private static void ForEachSensor(IHardware hw, Action<ISensor> action)
    {
        foreach (var s in hw.Sensors)
            action(s);
        foreach (var sub in hw.SubHardware)
            ForEachSensor(sub, action);
    }

    private static void WriteHardware(TextWriter w, IHardware hw, int depth)
    {
        var pad = new string(' ', depth * 2);
        w.WriteLine($"{pad}[{hw.HardwareType}] {hw.Name}  ({hw.Identifier})");
        foreach (var s in hw.Sensors.Where(s => s.SensorType is SensorType.Temperature or SensorType.Fan or SensorType.Control))
        {
            var mode = s.Control != null ? $"  mode={s.Control.ControlMode}" : "";
            w.WriteLine($"{pad}  {s.SensorType,-12} {s.Name,-28} {s.Value?.ToString("0.0") ?? "-",8}  {s.Identifier}{mode}");
        }
        foreach (var sub in hw.SubHardware)
            WriteHardware(w, sub, depth + 1);
    }

    private static SensorInfo ToInfo(IHardware hw, ISensor s, string unit) =>
        new(s.Identifier.ToString(), s.Name, hw.Name, hw.HardwareType.ToString(), s.SensorType.ToString(), s.Value, unit);

    private static bool SafePawnIoInstalled()
    {
        try { return PawnIo.IsInstalled; }
        catch { return false; }
    }
}
