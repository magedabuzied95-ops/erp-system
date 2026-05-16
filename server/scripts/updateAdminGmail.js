import db from "../database/db.js";
import bcrypt from "bcryptjs";

const updateAdminGmail = async () => {
  try {
    console.log("Updating admin@gmail.com user password...");
    
    // Hash the password
    const hashedPassword = await bcrypt.hash("admin", 10);
    
    // Update the user with email "admin@gmail.com"
    const result = await db.query(
      `
      UPDATE users SET password = $1 WHERE email = $2
      RETURNING id, name, email, role
      `,
      [hashedPassword, "admin@gmail.com"]
    );

    if (result.rows.length > 0) {
      console.log("User updated successfully!");
      console.log("Email: admin@gmail.com");
      console.log("Password: admin");
      console.log("User details:", result.rows[0]);
    } else {
      console.log("No user with email 'admin@gmail.com' found.");
    }
    
    // Show all users
    const allUsers = await db.query(`SELECT id, name, email, role FROM users`);
    console.log("\nAll users in database:", allUsers.rows);
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

updateAdminGmail();
