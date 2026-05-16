const logActivity = async (db, userId, action, entity, entityId = null, details = null) => {

  try {

    await db.query(

      `INSERT INTO activity_logs (user_id, action, entity, entity_id, details, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,

      [userId, action, entity, entityId, details]
    );

  } catch (err) {

    console.log("Log Error:", err.message);
  }

};

export default logActivity;
