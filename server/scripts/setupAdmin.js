import db from "../database/db.js";
import bcrypt from "bcryptjs";

const setupAdminUser = async () => {
  try {
    console.log("Setting up admin user...");
    
    // Delete all existing admin users
    await db.query(`DELETE FROM users WHERE role = 'admin'`);
    console.log("Deleted existing admin users.");
    
    // Hash the password
    const hashedPassword = await bcrypt.hash("admin", 10);
    
    // Create the admin user with exact credentials
    const result = await db.query(
      `
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role
      `,
      ["Admin", "admin", hashedPassword, "admin"]
    );

    console.log("\nAdmin user created successfully!");
    console.log("Email: admin");
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

setupAdminUser();
