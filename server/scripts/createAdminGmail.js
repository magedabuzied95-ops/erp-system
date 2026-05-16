import db from "../database/db.js";
import bcrypt from "bcryptjs";

const createAdminGmail = async () => {
  try {
    console.log("Creating admin@gmail.com user...");
    
    // Hash the password
    const hashedPassword = await bcrypt.hash("admin", 10);
    
    // Create the user with email "admin@gmail.com"
    const result = await db.query(
      `
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role
      `,
      ["Admin", "admin@gmail.com", hashedPassword, "admin"]
    );

    console.log("User created successfully!");
    console.log("Email: admin@gmail.com");
    console.log("Password: admin");
    console.log("User details:", result.rows[0]);
    
    // Show all users
    const allUsers = await db.query(`SELECT id, name, email, role FROM users`);
    console.log("\nAll users in database:", allUsers.rows);
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

createAdminGmail();
