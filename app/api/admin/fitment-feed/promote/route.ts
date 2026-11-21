import { adminHandler } from '@/lib/inventory/server';
import { promoteFitmentFeed } from '@/lib/inventory/fitment-feed';
export async function POST(request:Request){return adminHandler(request,()=>promoteFitmentFeed(request),true);}
