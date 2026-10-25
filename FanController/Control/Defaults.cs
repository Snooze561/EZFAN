using FanController.Hardware;

namespace FanController.Control;

/// <summary>First-launch configuration, migrations, and the four usage profiles built from the case layout.</summary>
public static class Defaults
{
    public static readonly string[] ProfileNames = ["Bureautique", "Jeux légers", "Jeux AAA", "Performance"];

    /// <summary>Fresh install: every fan stays on the BIOS until the wizard is done.</summary>
    public static AppConfig Build(Snapshot snap)
    {
        var config = new AppConfig
        {
            Safety = new Safety { CpuSensorId = FindCpu(snap), GpuSensorId = FindGpu(snap) },
            FanNames = snap.Controls.ToDictionary(c => c.Id, c => c.Name),
        };
        config.Profiles = BuildProfiles(config, snap);
        config.ActiveProfile = ProfileNames[0];
        return config;
    }

    /// <summary>Brings settings saved by older versions up to date.</summary>
    public static void Migrate(AppConfig config, Snapshot snap)
    {
        if (config.Layout != null) return;

        // Versions 2 and 3 only ever ran on Florian's Corsair 4000D.
        if (config.Slots.Count == 0) config.Slots = FlorianSlots(snap);
        config.Layout = new CaseLayout
        {
            CaseId = "corsair-4000d",
            Zones = new()
            {
                ["front"] = new() { Count = 3 }, ["top"] = new() { Count = 3 }, ["rear"] = new() { Count = 1 },
                ["side"] = new() { Count = 3 }, ["bottom"] = new() { Count = 0 },
            },
        };
        config.Cooler = new Cooler { Type = CoolerType.Aio, Size = 360, Zone = "front" };
        var curves = config.Active.Curves;
        config.IntakeSensorId = curves.FirstOrDefault(c => c.Id == "entree")?.SensorId;
        config.ExhaustSensorId = curves.FirstOrDefault(c => c.Id == "sortie")?.SensorId;
    }

    /// <summary>
    /// The four usage profiles. Each header gets a role from where its fans sit (AIO radiator, intake,
    /// exhaust, CPU cooler, pump) and follows the matching curve of the profile.
    /// </summary>
    public static Dictionary<string, Profile> BuildProfiles(AppConfig config, Snapshot snap)
    {
        var cpu = config.Safety.CpuSensorId ?? FindCpu(snap);
        var gpu = config.Safety.GpuSensorId ?? FindGpu(snap);
        var caseIn = config.IntakeSensorId ?? config.ExhaustSensorId ?? cpu;
        var caseOut = config.ExhaustSensorId ?? caseIn;

        var roles = new Dictionary<string, string>();
        foreach (var c in snap.Controls)
        {
            if (config.SpecialHeaders.TryGetValue(c.Id, out var special))
            {
                roles[c.Id] = special == HeaderRole.Pump ? "pump" : "cpu";
                continue;
            }
            var slots = config.Slots.Where(s => s.Value.Content == SlotContent.Fan && s.Value.ControlId == c.Id).ToList();
            if (slots.Count == 0) continue;
            var onRadiator = config.Cooler.Type == CoolerType.Aio && slots.Any(s => s.Key.StartsWith(config.Cooler.Zone + "-"));
            var intakes = slots.Count(s => s.Value.Direction == AirDirection.In);
            roles[c.Id] = onRadiator ? "cpu" : intakes * 2 >= slots.Count ? "entree" : "sortie";
        }

        // Games heat the case mostly through the graphics card, so the case fans follow it there.
        (string name, float[] cpuPts, float[] inPts, bool followGpu)[] presets =
        [
            ("Bureautique", [45, 25, 65, 35, 80, 60, 90, 100], [25, 30, 35, 40, 45, 70, 50, 100], false),
            ("Jeux légers", [45, 30, 65, 45, 80, 70, 90, 100], [25, 35, 35, 50, 45, 80, 50, 100], false),
            ("Jeux AAA", [45, 35, 65, 55, 80, 80, 88, 100], [40, 40, 60, 60, 75, 85, 82, 100], true),
            ("Performance", [40, 50, 60, 70, 75, 90, 85, 100], [35, 60, 55, 80, 70, 100], true),
        ];

        var profiles = new Dictionary<string, Profile>();
        foreach (var (name, cpuPts, inPts, followGpu) in presets)
        {
            var caseSensorIn = followGpu && gpu != null ? gpu : caseIn;
            var caseSensorOut = followGpu && gpu != null ? gpu : caseOut;
            var inName = followGpu && gpu != null ? "Entrée (suit la carte graphique)" : "Entrée boîtier";
            var outName = followGpu && gpu != null ? "Sortie (suit la carte graphique)" : "Sortie boîtier";
            profiles[name] = new Profile
            {
                Curves =
                [
                    new() { Id = "cpu", Name = config.Cooler.Type == CoolerType.Aio ? "CPU (AIO)" : "CPU (ventirad)", SensorId = cpu,
                            Hysteresis = 3, RampUp = 6, RampDown = 2, Points = Pts(cpuPts) },
                    new() { Id = "entree", Name = inName, SensorId = caseSensorIn, Points = Pts(inPts) },
                    // Exhausts a little slower than intakes keeps a slight positive pressure (less dust).
                    new() { Id = "sortie", Name = outName, SensorId = caseSensorOut, Points = Pts(inPts, -5) },
                ],
                Fans = snap.Controls.Select(c =>
                {
                    var role = roles.GetValueOrDefault(c.Id);
                    return role switch
                    {
                        null => new FanAssignment { ControlId = c.Id, Mode = FanMode.Bios },
                        "pump" => new FanAssignment { ControlId = c.Id, Mode = FanMode.Fixed, FixedPercent = 100 },
                        _ => new FanAssignment { ControlId = c.Id, Mode = FanMode.Curve, CurveId = role },
                    };
                }).ToList(),
            };
        }
        return profiles;
    }

    private static string? FindCpu(Snapshot snap) =>
        snap.Temperatures.FirstOrDefault(t => t.HardwareType == "Cpu" && (t.Name.Contains("Tctl") || t.Name.Contains("Package")))?.Id
        ?? snap.Temperatures.FirstOrDefault(t => t.HardwareType == "Cpu")?.Id;

    private static string? FindGpu(Snapshot snap) =>
        snap.Temperatures.FirstOrDefault(t => t.HardwareType is "GpuNvidia" or "GpuAmd" or "GpuIntel" && t.Name == "GPU Core"
                                              && !t.Hardware.Contains("(TM) Graphics"))?.Id
        ?? snap.Temperatures.FirstOrDefault(t => t.HardwareType.StartsWith("Gpu") && t.Name == "GPU Core")?.Id;

    /// <summary>Florian's 4000D: AIO 360 in front blowing out, 3 side intakes, top front in / top rear out, rear out.</summary>
    private static Dictionary<string, Slot> FlorianSlots(Snapshot snap)
    {
        const string exhaust = "/lpc/nct6799d/0/control/0", aio = "/lpc/nct6799d/0/control/1",
            topIn = "/lpc/nct6799d/0/control/2", side = "/lpc/nct6799d/0/control/3";
        string? Known(string id) => snap.Controls.Any(c => c.Id == id) ? id : null;
        Slot Fan(string id, AirDirection dir, string label) =>
            new() { Content = SlotContent.Fan, ControlId = Known(id), Direction = dir, Label = label };

        var slots = new Dictionary<string, Slot>();
        for (var i = 1; i <= 3; i++)
        {
            slots[$"front-{i}"] = Fan(aio, AirDirection.Out, "AIO 360");
            slots[$"side-{i}"] = Fan(side, AirDirection.In, "Côté");
        }
        slots["top-1"] = Fan(topIn, AirDirection.In, "Top avant");
        slots["top-2"] = Fan(exhaust, AirDirection.Out, "Top arrière");
        slots["rear-1"] = Fan(exhaust, AirDirection.Out, "Arrière");
        return slots;
    }

    private static List<CurvePoint> Pts(float[] flat, float offset = 0)
    {
        var pts = new List<CurvePoint>();
        for (var i = 0; i < flat.Length; i += 2)
        {
            var last = i == flat.Length - 2;
            // The last point always stays at 100 % so a hot system is never held back.
            pts.Add(new CurvePoint { Temp = flat[i], Percent = last ? 100 : Math.Clamp(flat[i + 1] + offset, 20, 100) });
        }
        return pts;
    }
}
