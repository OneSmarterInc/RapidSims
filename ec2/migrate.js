'use strict';
const { sql } = require('../platform/lib/db');
const statements = require('../platform/lib/schema');
sql().transaction(async tx => {
  await tx.query("SELECT pg_advisory_xact_lock(hashtext('rapidsims-schema'))");
  for (const statement of statements) await tx.query(statement);
}).then(()=>{ console.log('Additive database migration complete'); process.exit(0); })
  .catch(error=>{console.error('Migration failed:',error.code || error.message);process.exit(1);});
