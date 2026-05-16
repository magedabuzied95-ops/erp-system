import db from "../database/db.js";

const addAllPermissionsToAdminRole = async () => {
  try {
    console.log("Adding all permissions to admin role...");

    // Find the admin role
    const roleResult = await db.query(
      `SELECT id FROM roles WHERE name = 'admin' LIMIT 1`
    );

    if (roleResult.rows.length === 0) {
      console.log("admin role not found. Please run the seed script first.");
      return;
    }

    const adminRoleId = roleResult.rows[0].id;
    console.log("Admin role ID:", adminRoleId);

    // Get all permissions
    const permissionsResult = await db.query(`SELECT id FROM permissions`);

    console.log(`Found ${permissionsResult.rows.length} permissions`);

    // Add all permissions to admin role
    for (const permission of permissionsResult.rows) {
      await db.query(
        `
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT (role_id, permission_id) DO NOTHING
        `,
        [adminRoleId, permission.id]
      );
    }

    console.log("All permissions added to admin role successfully!");

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

addAllPermissionsToAdminRole();