export interface Portal {
    domain: string;
    displayName: string;
}

const  knownPortals: readonly Portal[] = [
    {
        domain:'skytransfer.hns.siasky.net',
        displayName:'Siasky.net'
    },
    {
        domain: 'skytransfer.hns.skyportal.xyz',
        displayName: 'SkyPortal.xyz'
    },
     {
        domain: 'skydrain.net',
        displayName: 'Skydrain.net'
    }, 
];

const LOCAL_STORAGE_KEY = 'CHOSEN_PORTAL_DOMAIN';

export const getDefaultPortal = (): Portal => {
    return knownPortals[0];
};

export const getCurrentPortal = (): Portal => {
    const portalDomain = localStorage.getItem(LOCAL_STORAGE_KEY);

    for(let portal of knownPortals) {
        if (portal.domain === portalDomain) {
            return portal
        }
    }
    
    return getDefaultPortal();
};

export const getUploadEndpoint = (): string  => {
    return `https://${getCurrentPortal().domain}/skynet/skyfile`;
} 

export const getEndpointInCurrentPortal = (): string  => {
    return `https://${getCurrentPortal().domain}`;
} 

export const getEndpointInDefaultPortal = (): string  => {
    return `https://${getDefaultPortal().domain}`;
} 

export const setPortalWithDomain = (domain: string) => {
    const portal = knownPortals.find(x => x.domain === domain);
    if (portal !== undefined) {
        localStorage.setItem(LOCAL_STORAGE_KEY, portal.domain);
    }
}

export const getPortals = (): readonly Portal[]  => knownPortals;