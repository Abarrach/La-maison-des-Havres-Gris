@echo off
rem ---------------------------------------------------------------------------
rem  maj_datamine.cmd -- LA commande de mise a jour apres un patch du jeu.
rem
rem  Double-clic. Elle fait tout, dans l'ordre, et finit par la liste des
rem  fichiers a envoyer sur le serveur. Rien n'est commite ni deploye.
rem
rem  Pourquoi un .cmd local et pas une page sur le site : les donnees viennent
rem  des fichiers du JEU, qui sont sur ce PC. Le serveur n'a ni le jeu, ni
rem  l'export, ni .NET. Une page web ne pourrait donc rien regenerer.
rem
rem  Volontairement sans accents (console cmd) et en CRLF (cf. .gitattributes).
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0.."

echo.
echo ============================================================
echo   1/3  Etat actuel
echo ============================================================
node tools\update_datamine.js --check
set RC=%ERRORLEVEL%

if "%RC%"=="0" (
  echo.
  echo Tout est deja a jour. Rien a faire.
  goto fin
)

echo.
echo ============================================================
echo   2/3  Regeneration
echo ============================================================
echo Lecture des paks du jeu, puis regeneration de ce qui est perime.
echo Compter quelques minutes. FModel n'est pas necessaire.
echo.
node tools\update_datamine.js --run-planner-import --with-meshes
if errorlevel 1 (
  echo.
  echo ECHEC pendant la regeneration -- voir le message ci-dessus.
  goto fin
)

echo.
echo ============================================================
echo   3/3  A envoyer sur le serveur ^(WinSCP^)
echo ============================================================
echo.
echo Fichiers de donnees modifies :
git status --short -- "*.json" "*.js" "*.html"
echo.
echo Meshes : si des .glb ont ete ajoutes, envoyer aussi models\
echo   ^(models\ n'est pas versionne : git ne le montre pas^)
echo.
echo Rappel : /v2 d'abord, Ctrl+F5, puis la racine. Droits dune:www-data, 664.
echo Si base_planner.js ou .html changent, le cache ^(?v=lotXX^) est deja bumpe.

:fin
echo.
if /i not "%~1"=="/nopause" pause
exit /b %RC%
