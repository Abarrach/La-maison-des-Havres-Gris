@echo off
rem ---------------------------------------------------------------------------
rem  verifier_datamine.cmd -- "est-ce qu'un patch du jeu a perime les donnees ?"
rem
rem  Double-clic depuis l'explorateur, ou tache planifiee (voir README).
rem  Ne modifie rien : appelle update_datamine.js --check.
rem
rem  Code de sortie : 0 = tout a jour  .  2 = du travail attend  .  1 = erreur.
rem
rem  Volontairement sans accents : une console cmd en page de codes 850 les
rem  afficherait de travers. Doit rester en CRLF (cf. .gitattributes), sinon
rem  cmd.exe lit le fichier caractere par caractere et tout part en erreur.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0.."

node tools\update_datamine.js --check
set RC=%ERRORLEVEL%

echo.
if "%RC%"=="2" (
  echo ============================================================
  echo   DES DONNEES SONT PERIMEES - voir la section "A faire" ci-dessus.
  echo ============================================================
) else if "%RC%"=="0" (
  echo Tout est a jour.
) else (
  echo Echec de la verification ^(code %RC%^).
)

rem Pause pour que la fenetre reste lisible apres un double-clic.
rem Une tache planifiee doit passer /nopause : sinon elle attend une touche que
rem personne ne tapera (l'astuce CMDCMDLINE ne les distingue pas, les deux cas
rem lancent "cmd /c ce-fichier").
if /i not "%~1"=="/nopause" pause
exit /b %RC%
