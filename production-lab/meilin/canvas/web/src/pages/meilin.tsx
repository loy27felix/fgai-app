export default function MeilinPage() {
    const prefix = window.location.pathname.startsWith("/fg-six/") ? "/fg-six" : "";
    return <iframe title="美林 · 超级导演" src={`${prefix}/meilin-app/`} className="h-full w-full border-0" allow="fullscreen; microphone; clipboard-write" allowFullScreen />;
}
