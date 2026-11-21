import type {Metadata} from 'next';
import { requireAdminPage } from '@/lib/auth';
import FitmentFeedClient from './ui';
import '../admin.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Supplier Fitment Staging | Olson & Tenglund',robots:{index:false,follow:false}};
export default async function Page(){await requireAdminPage();return <FitmentFeedClient/>;}
