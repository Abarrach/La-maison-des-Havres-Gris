(function () {
    if (!localStorage.getItem("user")) {
        window.location.replace("index.html#login");
    }
})();
