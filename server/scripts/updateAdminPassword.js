import db from "../database/db.js";
import bcrypt from "bcryptjs";

const updateAdminPassword = async () => {
  try {
    console.log("Checking users and updating admin password...");
    
    // First, let's see what users exist
    const allUsers = await db.query(`SELECT id, name, email, role FROM users`);
    console.log("Existing users:", allUsers.rows);
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash("admin", 10);
    
    // Update the user with email "admin" to set password
    const result = await db.query(
      `
      UPDATE users SET password = $1 WHERE email = $2
      RETURNING id, name, email, role
      `,
      [hashedPassword, "admin"]
    );

    if (result.rows.length > 0) {
      console.log("\nAdmin user password updated successfully!");
      console.log("Email: admin");
      console.log("Password: admin");
      console.log("User details:", result.rows[0]);
    } else {
      console.log("No user with email 'admin' found.");
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

updateAdminPassword();
