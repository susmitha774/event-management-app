const bcrypt = require("bcryptjs");

const password = "admin123"; // Replace with your actual admin password

bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(password, salt, (err, hash) => {
        if (err) throw err;
        console.log("Hashed Password:", hash);
    });
});
