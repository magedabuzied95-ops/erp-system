import db
from "../database/db.js";

/* ======================================================
   LOG ACTIVITY
====================================================== */

const logActivity =
  async ({

    userId = null,

    action,

    entity,

    entityId = null,

    details = ""

  }) => {

    try {

      await db.query(

        `
        INSERT INTO activity_logs

        (
          user_id,
          action,
          entity,
          entity_id,
          details
        )

        VALUES ($1,$2,$3,$4,$5)
        `,

        [

          userId,

          action,

          entity,

          entityId,

          details
        ]
      );

    } catch (error) {

      console.log(

        "Activity Log Error:",

        error.message
      );
    }
  };

export default logActivity;