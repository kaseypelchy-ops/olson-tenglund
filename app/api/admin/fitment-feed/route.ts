import { adminHandler } from '@/lib/inventory/server';
import { importFitmentFeed, listFitmentFeed, reviewFitmentFeed } from '@/lib/inventory/fitment-feed';
export const dynamic='force-dynamic';
export async function GET(request:Request){return adminHandler(request,()=>listFitmentFeed(request));}
export async function POST(request:Request){return adminHandler(request,()=>importFitmentFeed(request),true);}
export async function PATCH(request:Request){return adminHandler(request,()=>reviewFitmentFeed(request),true);}
