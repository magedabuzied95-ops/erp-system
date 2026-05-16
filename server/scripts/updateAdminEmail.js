import db from "../database/db.js";

const updateAdminEmail = async () => {
  try {
    console.log("Updating admin user email...");
    
    // Update the admin user email
    const result = await db.query(
      `
      UPDATE users SET email = $1 WHERE role = $2
      RETURNING id, name, email, role
      `,
      ["admin@aa.aa", "admin"]
    );

    if (result.rows.length > 0) {
      console.log("Admin user email updated successfully!");
      console.log("New email: admin@aa.aa");
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

updateAdminEmail();
