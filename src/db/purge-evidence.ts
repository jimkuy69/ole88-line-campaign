import 'dotenv/config';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { createDatabase } from './client.js';
import { evidence } from './schema.js';
import { FileSystemEvidenceStorage } from '../modules/evidence/storage.js';

async function main(){
  const databaseUrl=process.env.DATABASE_URL;
  if(!databaseUrl)throw new Error('DATABASE_URL is required');
  const days=Number(process.env.EVIDENCE_RETENTION_DAYS??180);
  if(!Number.isInteger(days)||days<1)throw new Error('EVIDENCE_RETENTION_DAYS must be a positive integer');
  const {db,pool}=createDatabase(databaseUrl);
  const storage=new FileSystemEvidenceStorage(process.env.EVIDENCE_STORAGE_DIR??'work/evidence');
  let deleted=0;
  try{
    const cutoff=new Date(Date.now()-days*24*60*60*1000);
    const expired=await db.select({id:evidence.id,storageKey:evidence.storageKey}).from(evidence)
      .where(and(lt(evidence.createdAt,cutoff),inArray(evidence.status,['APPROVED','REJECTED'])));
    for(const row of expired){
      try{
        await storage.delete(row.storageKey);
        const removed=await db.delete(evidence).where(and(eq(evidence.id,row.id),lt(evidence.createdAt,cutoff),inArray(evidence.status,['APPROVED','REJECTED']))).returning({id:evidence.id});
        deleted+=removed.length;
      }catch{
        // Keep the database row when file deletion fails so an operator can investigate safely.
      }
    }
    process.stdout.write(`Purged ${deleted} reviewed evidence file(s) older than ${days} days.\n`);
  }finally{await pool.end();}
}

main().catch((error:unknown)=>{process.stderr.write(`${error instanceof Error?error.message:'Evidence purge failed'}\n`);process.exitCode=1;});
