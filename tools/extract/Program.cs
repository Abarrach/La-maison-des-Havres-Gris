// DuneExtract — exporte en JSON les DataTables dont le site a besoin, sans FModel.
//
// ── Pourquoi ──────────────────────────────────────────────────────────────────────
// Jusqu'ici l'export était manuel : ouvrir FModel, retrouver une dizaine de dossiers,
// cliquer « Save Properties » sur chacun. FModel n'a pas de ligne de commande — mais il
// n'est qu'une interface au-dessus de CUE4Parse, qui est une bibliothèque. Ce programme
// fait donc le même travail, en une commande, et devient appelable par l'orchestrateur.
//
// ── Choix structurant : on écrit DANS l'arborescence d'export de FModel ───────────
// Chaque asset est écrit à <racine>/DuneSandbox/Content/Dune/<chemin>.json, exactement
// là où FModel l'aurait mis, et dans la même forme (un tableau d'objets exportés).
// Conséquence : AUCUN script tools/build_*.js ne change, et update_datamine.js voit des
// dates d'export fraîches sans rien savoir de ce programme. On remplace la main-d'œuvre,
// pas le format.
//
// ── Ce qu'il ne fait pas ──────────────────────────────────────────────────────────
// Il LIT les fichiers du jeu sur disque. Il ne lance rien, n'injecte rien, ne touche à
// aucun processus : il est sans effet sur une partie en cours et sur l'anti-triche.
//
// Usage :
//   DuneExtract --config <fichier.json> [--only <id,id>] [--list] [--dry-run]
//               [--paks <dossier>] [--usmap <f.usmap>] [--mapstructtypes <f.json>]
//               [--out <racine d'export>] [--aes 0x…]
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Serilog;

Log.Logger = new LoggerConfiguration().MinimumLevel.Error().WriteTo.Console().CreateLogger();

// ── Arguments ─────────────────────────────────────────────────────────────────────
string? Arg(string nom)
{
    var i = Array.FindIndex(args, a => a == "--" + nom);
    return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
}
bool Drapeau(string nom) => args.Contains("--" + nom);

var racineOutil = AppContext.BaseDirectory;
var cheminConfig = Arg("config") ?? Chercher("extract.config.json");
if (cheminConfig is null || !File.Exists(cheminConfig))
{
    Console.Error.WriteLine("Configuration introuvable. Passe --config <fichier.json>.");
    return 1;
}

var conf = JObject.Parse(File.ReadAllText(cheminConfig));
var dossierConfig = Path.GetDirectoryName(Path.GetFullPath(cheminConfig))!;

string? Resoudre(string? valeur)
{
    if (string.IsNullOrWhiteSpace(valeur)) return null;
    var v = Environment.ExpandEnvironmentVariables(valeur);
    return Path.IsPathRooted(v) ? v : Path.GetFullPath(Path.Combine(dossierConfig, v));
}

var paks = Arg("paks") ?? Resoudre(conf["paks"]?.ToString());
var usmap = Arg("usmap") ?? Resoudre(conf["usmap"]?.ToString());
var mst = Arg("mapstructtypes") ?? Resoudre(conf["mapstructtypes"]?.ToString());
var sortie = Arg("out") ?? Resoudre(conf["out"]?.ToString());
var aes = Arg("aes") ?? conf["aes"]?.ToString();
var langue = conf["locale"]?.ToString() ?? "fr";
var seulement = (Arg("only") ?? "").Split(',', StringSplitOptions.RemoveEmptyEntries).ToHashSet();

// Les réglages FModel font autorité pour les chemins quand la config ne les donne pas :
// c'est la source déjà utilisée par update_datamine.js, on reste cohérents.
var (fmPaks, fmUsmap) = LireFModel();
paks ??= fmPaks;
usmap ??= fmUsmap;
// Même règle que les outils Node : on prend le .usmap le PLUS RÉCENT du dossier, car
// FModel reste souvent configuré sur un ancien, et exporter avec un usmap périmé donne
// des champs manquants sans erreur.
if (usmap is not null && File.Exists(usmap))
{
    var plusRecent = Directory.EnumerateFiles(Path.GetDirectoryName(usmap)!, "*.usmap")
        .Select(f => new FileInfo(f)).OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault();
    if (plusRecent is not null && !string.Equals(plusRecent.FullName, Path.GetFullPath(usmap), StringComparison.OrdinalIgnoreCase))
    {
        Console.WriteLine($"usmap  : {Path.GetFileName(plusRecent.FullName)} (plus récent que celui réglé dans FModel)");
        usmap = plusRecent.FullName;
    }
}

var cibles = (conf["targets"] as JArray ?? new JArray())
    .Select(t => new Cible(
        (t["id"] ?? "?").ToString(),
        (t["path"] ?? "").ToString(),
        (t["mode"] ?? "file").ToString(),
        t["note"]?.ToString()))
    .Where(c => seulement.Count == 0 || seulement.Contains(c.Id))
    .ToList();

if (Drapeau("list"))
{
    Console.WriteLine($"Configuration : {cheminConfig}");
    Console.WriteLine($"Paks   : {paks}\nUsmap  : {usmap}\nTypes  : {mst}\nSortie : {sortie}\n");
    foreach (var c in cibles) Console.WriteLine($"  {c.Id,-18} {c.Mode,-6} {c.Chemin}");
    return 0;
}

foreach (var (nom, v) in new[] { ("paks", paks), ("usmap", usmap), ("out", sortie) })
    if (string.IsNullOrWhiteSpace(v)) { Console.Error.WriteLine($"Chemin manquant : {nom}"); return 1; }
if (!Directory.Exists(paks)) { Console.Error.WriteLine($"Dossier de paks introuvable : {paks}"); return 1; }
if (!File.Exists(usmap)) { Console.Error.WriteLine($"Usmap introuvable : {usmap}"); return 1; }

// ── Montage des paks ──────────────────────────────────────────────────────────────
Console.WriteLine($"paks   : {paks}");
Console.WriteLine($"usmap  : {Path.GetFileName(usmap)}");

var provider = new DefaultFileProvider(paks!, SearchOption.AllDirectories, false,
    new VersionContainer(EGame.GAME_DuneAwakening));
provider.Initialize();
if (!string.IsNullOrWhiteSpace(aes)) provider.SubmitKey(new FGuid(), new FAesKey(aes));
provider.Mount();
provider.MappingsContainer = new FileUsmapTypeMappingsProvider(usmap!);
Console.WriteLine($"         {provider.Files.Count} fichiers montés");

// La table des types de TMap : sans elle, Ingredients/Outcome et les coûts sortent VIDES,
// sans la moindre erreur. C'est le piège qui nous avait fait croire à des données
// « server-side » pendant des semaines.
if (!string.IsNullOrWhiteSpace(mst) && File.Exists(mst))
{
    var table = JObject.Parse(File.ReadAllText(mst!));
    var n = 0;
    foreach (var p in table.Properties())
    {
        string? k = p.Value["Key"]?.Type == JTokenType.Null ? null : p.Value["Key"]?.ToString();
        string? v = p.Value["Value"]?.Type == JTokenType.Null ? null : p.Value["Value"]?.ToString();
        provider.Versions.MapStructTypes[p.Name] = new KeyValuePair<string, string>(k!, v!);
        n++;
    }
    Console.WriteLine($"types  : {n} entrées de MapStructTypes injectées");
}
else Console.WriteLine("types  : ⚠ AUCUNE table de types — les TMap sortiront vides (recettes, coûts…)");

// Localisation : les traductions ne sont PAS dans les StringTable (qui ne portent que
// l'anglais source), elles s'appliquent aux propriétés FText des DataTables via le .locres.
// Sans ce chargement, les descriptions FR du site sortent en anglais.
// Localisation : les cultures « disponibles » viennent normalement d'un .locmeta ou du
// DefaultGame.ini. Dune n'en expose aucun exploitable ici, donc la validation de CUE4Parse
// refuse « fr » alors que le Game.locres français EST bien présent dans les paks.
// On détecte donc les cultures en listant les .locres, puis on force celle demandée.
var culturesVues = provider.Files.Keys
    .Where(k => k.EndsWith(".locres", StringComparison.OrdinalIgnoreCase))
    .Select(k => k.Split('/'))
    .Where(p => p.Length >= 2)
    .Select(p => p[^2])
    .Distinct(StringComparer.OrdinalIgnoreCase)
    .OrderBy(c => c).ToList();

bool langueOk = provider.TryChangeCulture(langue);
if (!langueOk && culturesVues.Contains(langue, StringComparer.OrdinalIgnoreCase))
{
    // La seule chose qui bloque est une liste de cultures restée VIDE : CUE4Parse la
    // remplit depuis un .locmeta ou le DefaultGame.ini, que ce jeu n'expose pas ici.
    // On y verse donc les cultures réellement présentes dans les paks, puis on repasse
    // par l'API publique. On complète la découverte, on ne contourne pas la logique.
    try
    {
        var dict = provider.Internationalization;
        var champ = dict.GetType().GetField("_availableCultures",
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        if (champ?.GetValue(dict) is List<string> liste)
        {
            foreach (var c in culturesVues) if (!liste.Contains(c)) liste.Add(c);
            langueOk = provider.TryChangeCulture(langue);
        }
    }
    catch (Exception e) { Console.WriteLine($"langue : découverte manuelle impossible — {e.Message}"); }
}

if (langueOk)
    Console.WriteLine($"langue : {langue} chargée ({provider.Internationalization.Count} entrées)");
else
    Console.WriteLine($"langue : ⚠ « {langue} » indisponible — textes en anglais. Cultures vues : "
        + (culturesVues.Count > 0 ? string.Join(", ", culturesVues.Take(12)) : "aucune"));

// ── Export ────────────────────────────────────────────────────────────────────────
var racineSortie = Path.GetFullPath(sortie!);
var total = 0; var ecrits = 0; var inchanges = 0; var rates = new List<string>();
var sec = Drapeau("dry-run");

Console.WriteLine($"sortie : {racineSortie}{(sec ? "   (dry-run : rien ne sera écrit)" : "")}\n");

foreach (var cible in cibles)
{
    var fichiers = cible.Mode == "dir"
        ? provider.Files.Keys.Where(k => k.Contains(cible.Chemin, StringComparison.OrdinalIgnoreCase)
                                      && k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)).ToList()
        : provider.Files.Keys.Where(k => k.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase)
                                      && k.Contains(cible.Chemin, StringComparison.OrdinalIgnoreCase)).ToList();

    if (fichiers.Count == 0) { rates.Add($"{cible.Id} : aucun asset pour « {cible.Chemin} »"); continue; }

    var n = 0; var nEcrits = 0;
    foreach (var cle in fichiers)
    {
        var sansExt = cle[..^".uasset".Length];
        try
        {
            var objets = provider.LoadPackageObjects(sansExt).ToArray();
            if (objets.Length == 0) continue;
            var json = JsonConvert.SerializeObject(objets, Formatting.Indented);
            n++; total++;

            // Chemin de sortie IDENTIQUE à celui de FModel : <out>/<clé du pak>.json
            var dest = Path.Combine(racineSortie, sansExt.Replace('/', Path.DirectorySeparatorChar) + ".json");
            if (sec) continue;
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            // Ne réécrire que si le contenu change : les dates de fichier servent de signal
            // de fraîcheur à update_datamine.js, les bousculer pour rien brouillerait le
            // diagnostic (et ferait reconstruire des étapes qui n'ont pas lieu d'être).
            if (File.Exists(dest) && File.ReadAllText(dest) == json) { inchanges++; continue; }
            File.WriteAllText(dest, json);
            nEcrits++; ecrits++;
        }
        catch (Exception e) { rates.Add($"{cible.Id} : {sansExt} — {e.Message}"); }
    }
    Console.WriteLine($"  {cible.Id,-18} {n,5} asset(s) lus, {nEcrits,5} écrit(s)"
        + (cible.Note is null ? "" : $"   — {cible.Note}"));
}

Console.WriteLine($"\n{total} asset(s) traités · {ecrits} écrit(s) · {inchanges} inchangé(s)");
if (rates.Count > 0)
{
    Console.WriteLine($"\n{rates.Count} problème(s) :");
    foreach (var r in rates.Take(20)) Console.WriteLine("  " + r);
    if (rates.Count > 20) Console.WriteLine($"  … (+{rates.Count - 20})");
}
Console.WriteLine("\nRien n'a été commité ni déployé. Enchaîne avec : node tools/update_datamine.js");
return rates.Count > 0 && total == 0 ? 1 : 0;

// ── Utilitaires ───────────────────────────────────────────────────────────────────
string? Chercher(string nom)
{
    foreach (var d in new[] { Directory.GetCurrentDirectory(), racineOutil, Path.Combine(racineOutil, "..", "..", "..") })
    {
        var p = Path.GetFullPath(Path.Combine(d, nom));
        if (File.Exists(p)) return p;
    }
    return null;
}

(string?, string?) LireFModel()
{
    try
    {
        var f = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "FModel", "AppSettings.json");
        if (!File.Exists(f)) return (null, null);
        var s = JObject.Parse(File.ReadAllText(f));
        var dossierPaks = s["GameDirectory"]?.ToString();
        string? mappings = null;
        foreach (var p in (s["PerDirectory"] as JObject)?.Properties() ?? Enumerable.Empty<JProperty>())
        {
            if (!p.Name.Contains("Dune", StringComparison.OrdinalIgnoreCase)) continue;
            foreach (var e in p.Value["Endpoints"] as JArray ?? new JArray())
            {
                var fp = e["FilePath"]?.ToString();
                if (!string.IsNullOrWhiteSpace(fp)) mappings = fp;
            }
        }
        return (dossierPaks, mappings);
    }
    catch { return (null, null); }
}

record Cible(string Id, string Chemin, string Mode, string? Note);
