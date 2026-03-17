import { NextRequest, NextResponse } from 'next/server';
import { portfolioClient } from '@/lib/grpcClients';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get('user_id') ?? 'default';
  try {
    const portfolio = await new Promise<any>((resolve, reject) => {
      portfolioClient.getPortfolio({ user_id: userId }, (err: any, res: any) =>
        err ? reject(err) : resolve(res)
      );
    });
    return NextResponse.json(portfolio);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
