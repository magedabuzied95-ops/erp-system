import db from "../database/db.js";
import bcrypt from "bcryptjs";

const updateAdminCredentials = async () => {
  try {
    console.log("Updating admin user credentials...");
    
    // Hash the new password
    const hashedPassword = await bcrypt.hash("admin", 10);
    
    // Update the admin user with new credentials
    const result = await db.query(
      `
      UPDATE users SET email = $1, password = $2 WHERE role = $3
      RETURNING id, name, email, role
      `,
      ["admin", hashedPassword, "admin"]
    );

    if (result.rows.length > 0) {
      console.log("Admin user credentials updated successfully!");
      console.log("Email: admin");
      console.log("Password: admin");
      console.log("User details:", result.rows[0]);
    } else {
      console.log("No admin user found to update.");
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error updating admin user:", error);
    process.exit(1);
  }
};

updateAdminCredentials();
