import { dispatchConnect } from '@/lib/traderBff';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => dispatchConnect(req);
export const POST = (req: Request) => dispatchConnect(req);
