using System.Text.Json;
using System.Text.Json.Serialization;

namespace FanController.Control;

public enum FanMode { Bios, Fixed, Curve }

public class CurvePoint
{
    public float Temp { get; set; }
    public float Percent { get; set; }
}

public class Curve
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..8];
    public string Name { get; set; } = "Nouvelle courbe";
    public string? SensorId { get; set; }
    public List<CurvePoint> Points { get; set; } = [];
    /// <summary>°C the temperature must drop before the fans slow down again.</summary>
    public float Hysteresis { get; set; } = 2;
    /// <summary>Max change in %/second when speeding up.</summary>
    public float RampUp { get; set; } = 8;
    /// <summary>Max change in %/second when slowing down.</summary>
    public float RampDown { get; set; } = 3;
}

public class FanAssignment
{
    public string ControlId { get; set; } = "";
    public FanMode Mode { get; set; } = FanMode.Bios;
    public float FixedPercent { get; set; } = 50;
    public string? CurveId { get; set; }
}

public class Profile
{
    public List<Curve> Curves { get; set; } = [];
    public List<FanAssignment> Fans { get; set; } = [];
}

public class Safety
{
    public string? CpuSensorId { get; set; }
    public string? GpuSensorId { get; set; }
    /// <summary>Above this CPU temperature every managed fan goes to 100 %.</summary>
    public float CriticalCpu { get; set; } = 95;
    public float CriticalGpu { get; set; } = 85;
}

public enum SlotContent { Empty, Fan }

public enum AirDirection { In, Out }

/// <summary>One fan position of the case (front-1, top-2, rear-1, side-3...).</summary>
public class Slot
{
    public SlotContent Content { get; set; } = SlotContent.Empty;
    public string? ControlId { get; set; }
    public AirDirection Direction { get; set; } = AirDirection.In;
    public int Size { get; set; } = 120;
    public string Label { get; set; } = "";
}

public class ZoneLayout
{
    public int Count { get; set; }
    public int Size { get; set; } = 120;
}

/// <summary>Which case it is and how many fan slots each zone (front, top, rear, side, bottom) has.</summary>
public class CaseLayout
{
    public string CaseId { get; set; } = "generic";
    public Dictionary<string, ZoneLayout> Zones { get; set; } = [];
}

public enum CoolerType { Air, Aio }

public class Cooler
{
    public CoolerType Type { get; set; } = CoolerType.Air;
    /// <summary>Radiator length in mm (240, 280, 360...).</summary>
    public int Size { get; set; } = 360;
    public string Zone { get; set; } = "front";
}

/// <summary>Headers that drive something other than a case slot.</summary>
public enum HeaderRole { CpuCooler, Pump }

public class AppConfig
{
    /// <summary>False until the first-launch wizard has been completed.</summary>
    public bool SetupDone { get; set; }
    public CaseLayout? Layout { get; set; }
    public Cooler Cooler { get; set; } = new();
    public Dictionary<string, Slot> Slots { get; set; } = [];
    public Dictionary<string, HeaderRole> SpecialHeaders { get; set; } = [];
    /// <summary>Motherboard sensors chosen to represent the air coming in and going out.</summary>
    public string? IntakeSensorId { get; set; }
    public string? ExhaustSensorId { get; set; }
    /// <summary>Version 3 setting, only read to migrate to <see cref="Cooler"/>.</summary>
    public bool FrontRadiator { get; set; }

    public string ActiveProfile { get; set; } = "Équilibré";
    public Dictionary<string, Profile> Profiles { get; set; } = [];
    /// <summary>User labels for each control, by control id.</summary>
    public Dictionary<string, string> FanNames { get; set; } = [];
    public Safety Safety { get; set; } = new();

    [JsonIgnore]
    public Profile Active => Profiles.TryGetValue(ActiveProfile, out var p) ? p : Profiles.Values.First();
}

public static class ConfigStore
{
    public static readonly string Folder =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "EZFAN");

    // Where versions 1 to 3 (still called FanController 4000D) kept their settings.
    private static readonly string OldFile =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FanController4000D", "config.json");

    public static readonly string FilePath = Path.Combine(Folder, "config.json");

    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
    };

    public static AppConfig? Load()
    {
        try
        {
            if (!File.Exists(FilePath) && File.Exists(OldFile))
            {
                Directory.CreateDirectory(Folder);
                File.Copy(OldFile, FilePath);
            }
            if (!File.Exists(FilePath)) return null;
            var config = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(FilePath), Json);
            return config is { Profiles.Count: > 0 } ? config : null;
        }
        catch
        {
            // A broken file must never stop the fans from being controlled: keep a copy and start fresh.
            File.Copy(FilePath, FilePath + ".corrompu", true);
            return null;
        }
    }

    public static void Save(AppConfig config)
    {
        Directory.CreateDirectory(Folder);
        var tmp = FilePath + ".tmp";
        File.WriteAllText(tmp, JsonSerializer.Serialize(config, Json));
        File.Move(tmp, FilePath, true);
    }
}
