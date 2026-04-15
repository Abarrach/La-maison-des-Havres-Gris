async function register() {
  const user = document.getElementById("newUser").value.trim();
  const pass = document.getElementById("newPass").value.trim();
  const msg = document.getElementById("registerMessage");

  if (!user || !pass) {
    msg.innerText = "Merci de remplir tous les champs.";
    msg.style.color = "orange";
    return;
  }

  const payload = { action: "register", user, password: pass };

  const res = await fetch("save.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const json = await res.json();
  if (json.ok) {
    msg.innerText = "Compte créé ! Vous pouvez vous connecter.";
    msg.style.color = "lightgreen";
  } else {
    msg.innerText = "Erreur : " + json.error;
    msg.style.color = "red";
  }
}
