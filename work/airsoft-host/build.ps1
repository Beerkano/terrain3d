param(
    [string]$SdkDirectory = 'C:\Program Files\Microsoft Office\root\Office16\ADDINS\Microsoft Power Query for Excel Integrated\bin',
    [string]$EditorPath = (Join-Path $PSScriptRoot '..\airsoft-desktop.html'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '..\..\outputs\Terrain-Airsoft-3D.exe')
)
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $env:windir 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$core = Join-Path $SdkDirectory 'Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $SdkDirectory 'Microsoft.Web.WebView2.WinForms.dll'
$loader = Join-Path $SdkDirectory 'WebView2Loader.dll'
$source = Join-Path $PSScriptRoot 'Program.cs'
$packed = [IO.Path]::GetTempFileName()
try {
$stream = [IO.File]::Create($packed)
try {
    $gzip = New-Object IO.Compression.GZipStream($stream,[IO.Compression.CompressionMode]::Compress)
    try {
        $bytes = [IO.File]::ReadAllBytes($EditorPath)
        $gzip.Write($bytes,0,$bytes.Length)
    } finally { $gzip.Dispose() }
} finally { $stream.Dispose() }
$arguments = @(
    '/nologo','/target:winexe','/platform:x64','/optimize+','/codepage:65001',
    '/reference:System.dll','/reference:System.Core.dll','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll',
    "/reference:$core", "/reference:$forms", "/out:$OutputPath",
    "/resource:$PSScriptRoot\..\..\outputs\La cour couverte.airsoft.json,Airsoft.SamplePlan", "/resource:$packed,Airsoft.Editor.gz", "/resource:$PSScriptRoot\self-test.js,Airsoft.SelfTest",
    "/resource:$core,Airsoft.Microsoft.Web.WebView2.Core.dll",
    "/resource:$forms,Airsoft.Microsoft.Web.WebView2.WinForms.dll",
    "/resource:$loader,Airsoft.WebView2Loader.dll", $source
)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($OutputPath))) | Out-Null
& $compiler @arguments
if ($LASTEXITCODE -ne 0) { throw 'La compilation a échoué.' }
Get-Item -LiteralPath $OutputPath | Select-Object FullName, Length
} finally { [IO.File]::Delete($packed) }
