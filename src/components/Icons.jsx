const base = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };

export const OverviewIcon = () => (<svg {...base}><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></svg>);
export const ActivityIcon = () => (<svg {...base}><path d="M4 6h16M4 12h16M4 18h10" /></svg>);
export const SpendingIcon = () => (<svg {...base}><circle cx="12" cy="12" r="8" /><path d="M12 4v8l6 4" /></svg>);
export const AccountsIcon = () => (<svg {...base}><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18M7 15h4" /></svg>);
export const UpcomingIcon = () => (<svg {...base}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M8 15h3" /></svg>);
