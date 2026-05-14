(function () {
    if (!localStorage.getItem("user")) {
        window.location.replace("login.html");
    }
})();
