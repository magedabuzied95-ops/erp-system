import db from "../database/db.js";

const assignSuperAdminRoleToAdminUser = async () => {
  try {
    console.log("Assigning super_admin role to admin user...");

    // Find the super_admin role
    const roleResult = await db.query(
      `SELECT id FROM roles WHERE name = 'super_admin' LIMIT 1`
    );

    if (roleResult.rows.length === 0) {
      console.log("super_admin role not found. Please run the seed script first.");
      return;
    }

    const superAdminRoleId = roleResult.rows[0].id;
    console.log("Super admin role ID:", superAdminRoleId);

    // Update the admin user to have this role
    const userResult = await db.query(
      `
      UPDATE users SET role_id = $1, is_super_admin = true WHERE email = 'admin'
      RETURNING id, name, email, role_id
      `,
      [superAdminRoleId]
    );

    if (userResult.rows.length > 0) {
      console.log("Admin user updated successfully!");
      console.log("User details:", userResult.rows[0]);
    } else {
      console.log("No user with email 'admin' found.");
    }

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

assignSuperAdminRoleToAdminUser();