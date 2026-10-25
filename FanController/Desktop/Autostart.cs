using System.Diagnostics;
using System.Security;

namespace FanController.Desktop;

/// <summary>
/// Starts the app at logon through the Task Scheduler. The Startup folder cannot be used:
/// the app needs admin rights and Windows would ask for them at every boot.
/// </summary>
public static class Autostart
{
    private const string TaskName = "EZFAN";
    private const string OldTaskName = "FanController4000D";

    public static bool IsEnabled() => Run("/Query", "/TN", TaskName) == 0;

    public static bool Enable()
    {
        var exe = Environment.ProcessPath!;
        // Written as XML because the schtasks defaults would stop the app after 72 h and on battery.
        var xml = $"""
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo><Description>Pilotage des ventilateurs (EZFAN)</Description></RegistrationInfo>
              <Triggers><LogonTrigger><Enabled>true</Enabled><Delay>PT10S</Delay></LogonTrigger></Triggers>
              <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
              <Settings>
                <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
                <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
                <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
                <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
                <Priority>4</Priority>
              </Settings>
              <Actions Context="Author"><Exec><Command>{SecurityElement.Escape(exe)}</Command><Arguments>--background</Arguments></Exec></Actions>
            </Task>
            """;
        var file = Path.Combine(Path.GetTempPath(), "EZFAN-task.xml");
        File.WriteAllText(file, xml, System.Text.Encoding.Unicode);
        try { return Run("/Create", "/TN", TaskName, "/XML", file, "/F") == 0; }
        finally { File.Delete(file); }
    }

    /// <summary>Versions 1 to 3 registered their logon task under the old name.</summary>
    public static void MigrateOldTask()
    {
        if (Run("/Query", "/TN", OldTaskName) != 0) return;
        Run("/Delete", "/TN", OldTaskName, "/F");
        Enable();
    }

    public static bool Disable() => Run("/Delete", "/TN", TaskName, "/F") == 0;

    /// <summary>A new version unzipped elsewhere must take over the logon task.</summary>
    public static void RefreshPath()
    {
        if (IsEnabled()) Enable();
    }

    private static int Run(params string[] args)
    {
        try
        {
            var psi = new ProcessStartInfo("schtasks.exe") { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var a in args) psi.ArgumentList.Add(a);
            using var p = Process.Start(psi)!;
            p.WaitForExit(10000);
            return p.ExitCode;
        }
        catch
        {
            return -1;
        }
    }
}
