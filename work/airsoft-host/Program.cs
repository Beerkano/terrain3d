using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Terrain Airsoft 3D")]
[assembly: AssemblyProduct("Terrain Airsoft 3D")]
[assembly: AssemblyDescription("Éditeur de terrain d’airsoft hors ligne")]
[assembly: AssemblyVersion("1.9.0.0")]
[assembly: AssemblyCompany("beerkano")]
[assembly: AssemblyCopyright("© 2026 beerkano — Code spécifique à Terrain Airsoft 3D")]

internal static class Program
{
    internal const string Title = "Terrain Airsoft 3D";
    private const string PageResource = "Airsoft.Editor.gz";
    internal static byte[] ReadPage()
    {
        using (var input = new MemoryStream(ReadResource(PageResource)))
        using (var gzip = new System.IO.Compression.GZipStream(input, System.IO.Compression.CompressionMode.Decompress))
        using (var output = new MemoryStream()) { gzip.CopyTo(output); return output.ToArray(); }
    }

    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [STAThread]
    private static int Main(string[] args)
    {
        bool verify = args.Length == 1 && args[0] == "--verify";
        bool selfTest = args.Length == 1 && args[0] == "--self-test";
        bool verifyPayload = args.Length == 1 && args[0] == "--verify-payload";
        bool testing = verify || selfTest || verifyPayload;
        try
        {
            AppDomain.CurrentDomain.AssemblyResolve += ResolveEmbeddedAssembly;
            if (verifyPayload)
            {
                string html = System.Text.Encoding.UTF8.GetString(ReadPage());
                foreach (string name in new[] {"Microsoft.Web.WebView2.Core", "Microsoft.Web.WebView2.WinForms"})
                    if (Assembly.Load(ReadResource("Airsoft." + name + ".dll")).GetName().Name != name) return 3;
                byte[] native = ReadResource("Airsoft.WebView2Loader.dll");
                if (native.Length < 2048 || native[0] != 'M' || native[1] != 'Z') return 4;
                return html.Contains("airsoft-terrain-editor") && html.Contains("AirsoftRenderer") ? 0 : 5;
            }
            string root = testing
                ? Path.Combine(Path.GetTempPath(), "TA3D-test")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TerrainAirsoft3D");
            string page = Path.Combine(root, "interface");
            string loader = Extract("Airsoft.WebView2Loader.dll", "WebView2Loader.dll", Path.Combine(root, "moteur"));
            if (verify) return VerifyEngine(Path.GetDirectoryName(loader));
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (selfTest) return RunSelfTest(page, Path.GetDirectoryName(loader), Path.Combine(root, "p-" + Guid.NewGuid().ToString("N").Substring(0,8)));
            try { RunWindow(page, Path.GetDirectoryName(loader), Path.Combine(root, "profil")); }
            catch (Exception) { OpenBrowser(page); }
            return 0;
        }
        catch (Exception error)
        {
            if (testing) Console.Error.WriteLine(error);
            else MessageBox.Show("Impossible d’ouvrir la maquette.\n\n" + error.Message, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static Assembly ResolveEmbeddedAssembly(object sender, ResolveEventArgs args)
    {
        string name = new AssemblyName(args.Name).Name;
        if (name != "Microsoft.Web.WebView2.Core" && name != "Microsoft.Web.WebView2.WinForms") return null;
        return Assembly.Load(ReadResource("Airsoft." + name + ".dll"));
    }

    private static byte[] ReadResource(string name)
    {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (var bytes = new MemoryStream())
        {
            if (stream == null) throw new InvalidDataException("Ressource manquante : " + name);
            stream.CopyTo(bytes);
            return bytes.ToArray();
        }
    }

    private static string Digest(byte[] data)
    {
        using (SHA256 hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(data)).Replace("-", "");
    }

    private static string Extract(string resource, string name, string folder)
    {
        byte[] bytes = resource == PageResource ? ReadPage() : ReadResource(resource);
        string digest = Digest(bytes);
        string directory = Path.Combine(folder, digest.Substring(0,16));
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, name);
        if (File.Exists(path) && Digest(File.ReadAllBytes(path)) == digest) return path;
        string staged = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".tmp");
        File.WriteAllBytes(staged, bytes);
        try
        {
            if (File.Exists(path)) File.Replace(staged, path, null);
            else File.Move(staged, path);
        }
        catch (IOException)
        {
            // A concurrent launch may already have installed the same bytes.
            if (!File.Exists(path) || Digest(File.ReadAllBytes(path)) != digest) throw;
        }
        finally { if (File.Exists(staged)) File.Delete(staged); }
        return path;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int VerifyEngine(string loaderFolder)
    {
        CoreWebView2Environment.SetLoaderDllFolderPath(loaderFolder);
        GC.KeepAlive(typeof(WebView2));
        return String.IsNullOrEmpty(CoreWebView2Environment.GetAvailableBrowserVersionString()) ? 2 : 0;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void RunWindow(string page, string loaderFolder, string profile)
    {
        CoreWebView2Environment.SetLoaderDllFolderPath(loaderFolder);
        using (var window = new EditorWindow(page, profile)) Application.Run(window);
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int RunSelfTest(string page, string loaderFolder, string profile)
    {
        CoreWebView2Environment.SetLoaderDllFolderPath(loaderFolder);
        using (var window = new EditorWindow(page, profile, true))
        {
            Application.Run(window);
            return window.TestResult;
        }
    }

    internal static void OpenBrowser(string page)
    {
        string path = Extract(PageResource, "index.html", page);
        Process.Start(new ProcessStartInfo(new Uri(path).AbsoluteUri) { UseShellExecute = true });
    }
}

internal sealed class EditorWindow : Form
{
    private const string VirtualHost = "terrain-airsoft.invalid";
    private readonly string page;
    private readonly string profile;
    private readonly WebView2 editor = new WebView2();
    private readonly bool testing;
    private readonly Timer timeout = new Timer();
    internal int TestResult { get; private set; }

    internal EditorWindow(string pagePath, string profilePath, bool selfTest = false)
    {
        page = pagePath;
        profile = profilePath;
        testing = selfTest;
        Text = Program.Title;
        Size = new Size(1280, 900);
        MinimumSize = new Size(640, 480);
        StartPosition = FormStartPosition.CenterScreen;
        if (testing)
        {
            Opacity = 0;
            ShowInTaskbar = false;
            TestResult = 6;
            timeout.Interval = 20000;
            timeout.Tick += delegate { timeout.Stop(); Close(); };
            timeout.Start();
            FormClosed += delegate { timeout.Dispose(); };
        }
        editor.Dock = DockStyle.Fill;
        Controls.Add(editor);
        Shown += StartEditor;
    }

    private async void StartEditor(object sender, EventArgs args)
    {
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            if (IsDisposed) return;
            await editor.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;
            var core = editor.CoreWebView2;
            string address = "https://" + VirtualHost + "/index.html";
            byte[] document = Program.ReadPage();
            core.AddWebResourceRequestedFilter(address, CoreWebView2WebResourceContext.Document);
            core.WebResourceRequested += delegate(object source, CoreWebView2WebResourceRequestedEventArgs request) {
                if (String.Equals(request.Request.Uri,address,StringComparison.Ordinal))
                    request.Response = environment.CreateWebResourceResponse(new MemoryStream(document,false),200,"OK","Content-Type: text/html; charset=utf-8\r\nCache-Control: no-store");
            };
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.NewWindowRequested += delegate(object source, CoreWebView2NewWindowRequestedEventArgs e) { e.Handled = true; };
            core.DownloadStarting += SavePlan;
            if (testing) {
                using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("Airsoft.SamplePlan")))
                    await core.AddScriptToExecuteOnDocumentCreatedAsync("window.samplePlan=" + reader.ReadToEnd() + ";localStorage.setItem('terrain-airsoft.desktop.plan.v1',JSON.stringify({modelContent:{plan:window.samplePlan}}));");
            }
            if (testing) core.NavigationCompleted += async delegate(object source, CoreWebView2NavigationCompletedEventArgs completed)
            {
                try
                {
                    if (!completed.IsSuccess) throw new InvalidOperationException(completed.WebErrorStatus.ToString());
                    using (var reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("Airsoft.SelfTest")))
                        await core.ExecuteScriptAsync(reader.ReadToEnd());
                    string result;
                    do {
                        await System.Threading.Tasks.Task.Delay(50);
                        if (IsDisposed) return;
                        result = await core.ExecuteScriptAsync("window.testOutcome || null");
                    } while (result == "null");
                    Console.Error.WriteLine(result);
                    TestResult = result == "\"ok 44\"" ? 0 : 7;
                }
                catch (Exception failure) { Console.Error.WriteLine(failure); TestResult = 8; }
                finally { if (!IsDisposed) Close(); }
            };
            core.Navigate("https://" + VirtualHost + "/index.html");
        }
        catch (Exception problem)
        {
            if (IsDisposed) return;
            if (testing) { Console.Error.WriteLine(problem); TestResult = 9; Close(); return; }
            try { Program.OpenBrowser(page); }
            catch (Exception error) { MessageBox.Show(this, error.Message, Program.Title, MessageBoxButtons.OK, MessageBoxIcon.Error); }
            Close();
        }
    }

    private void SavePlan(object sender, CoreWebView2DownloadStartingEventArgs args)
    {
        var deferral = args.GetDeferral();
        // Run modal UI after the WebView2 event handler has returned.
        BeginInvoke((Action)delegate {
            try
            {
                args.Handled = true;
                using (var dialog = new SaveFileDialog())
                {
                    bool image = String.Equals(Path.GetExtension(args.ResultFilePath), ".png", StringComparison.OrdinalIgnoreCase);
                    dialog.Title = image ? "Exporter la vue" : "Enregistrer le plan";
                    dialog.Filter = image ? "Image PNG (*.png)|*.png" : "Plan du terrain (*.json)|*.json";
                    dialog.DefaultExt = image ? "png" : "json";
                    dialog.FileName = Path.GetFileName(args.ResultFilePath);
                    if (dialog.ShowDialog(this) == DialogResult.OK) args.ResultFilePath = dialog.FileName;
                    else args.Cancel = true;
                }
            }
            catch { args.Cancel = true; }
            finally { deferral.Complete(); }
        });
    }
}
