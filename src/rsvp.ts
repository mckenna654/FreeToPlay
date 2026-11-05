import prisma from './prisma';

export type RsvpResult = 'saved' | 'full' | 'missing';

// The one place RSVPs are saved, for the web and Discord alike. Checking the limit and saving
// share a transaction, so two people can't both take the last seat. Someone already confirmed
// keeps their seat, and "maybe" or "can't make it" never needs one.
export function saveRsvp(sessionId: string, userId: string, status: string): Promise<RsvpResult> {
    return prisma.$transaction(async (tx): Promise<RsvpResult> => {
        const session = await tx.gameSession.findUnique({
            where: { id: sessionId },
            select: { maxPlayers: true, rsvps: { where: { status: 'CONFIRMED' }, select: { userId: true } } }
        });
        if (!session) return 'missing';
        const hasSeat = session.rsvps.some(rsvp => rsvp.userId === userId);
        if (status === 'CONFIRMED' && !hasSeat && session.rsvps.length >= session.maxPlayers) return 'full';
        await tx.rSVP.upsert({
            where: { sessionId_userId: { sessionId, userId } },
            update: { status },
            create: { sessionId, userId, status }
        });
        return 'saved';
    });
}
