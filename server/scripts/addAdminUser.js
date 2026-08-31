import db from "../database/db.js";
import bcrypt from "bcryptjs";

const addAdminUser = async () => {
  try {
    console.log("Checking if users table exists...");
    
    // First, create the users table if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100),
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log("Users table created or already exists.");
    
    // Check if admin user already exists
    const userExists = await db.query(
      `SELECT * FROM users WHERE email = $1`,
      ["admin@aa.aa"]
    );

    if (userExists.rows.length > 0) {
      console.log("Admin user already exists.");
      process.exit(0);
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash("admin", 10);

    // Insert admin user
    const result = await db.query(
      `
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role
      `,
      ["Admin", "admin@aa.aa", hashedPassword, "admin"]
    );

    console.log("Admin user created successfully!");
    console.log("Email: admin@aa.aa");
    console.log("Password: admin");
    console.log("User details:", result.rows[0]);
    
    process.exit(0);
  } catch (error) {
    console.error("Error creating admin user:", error);
    process.exit(1);
  }
};

addAdminUser();
