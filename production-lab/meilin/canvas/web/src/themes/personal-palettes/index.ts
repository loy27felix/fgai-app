import { DEFAULT_CLASSIC_SKIN, type SkinModeTokens } from "@/lib/skin-themes";
import { registerThemePack } from "../registry";
import "./theme.css";

const palettes = [
    {id:"sea-salt", name:"海盐蓝", light:["#eef5fa","#fcfdff","#286080"], dark:["#111d28","#182937","#9ecfe8"]},
    {id:"forest", name:"森林绿", light:["#eef4ef","#fcfefb","#386447"], dark:["#15211b","#1d2d24","#afd0b4"]},
    {id:"warm-paper", name:"暖纸", light:["#f6f0e5","#fffdf8","#785335"], dark:["#251f19","#30281f","#e4c09b"]},
    {id:"rose", name:"玫瑰", light:["#f8f0f3","#fffbfd","#8c4566"], dark:["#291d24","#342630","#e5b1c9"]},
    {id:"graphite", name:"石墨", light:["#f0f1f2","#fcfcfd","#485463"], dark:["#191d23","#242a32","#b5c6dd"]},
] as const;

function colors(base: SkinModeTokens, values: readonly string[], dark: boolean): SkinModeTokens {
    const [background,surface,accent] = values;
    return {...base, canvas:background, workspace:background, surface, surfaceRaised:surface, surfaceSubtle:background,
        primary:accent, primaryHover:accent, primaryActive:accent, primaryForeground: dark ? "#15191f" : "#ffffff",
        selected: dark ? surface : background, selectedForeground:accent, iconActive:accent, controlFocus:accent,
        adminBackground:background, adminSurface:surface, adminSubtle:background, authBackground:background, authPanel:surface,
    };
}
for (const palette of palettes) {
    const skin = { ...DEFAULT_CLASSIC_SKIN, id:palette.id, name:palette.name, description:"个人配色 · 支持浅色与深色", locked:true,
        tokens:{...DEFAULT_CLASSIC_SKIN.tokens,
            light:colors(DEFAULT_CLASSIC_SKIN.tokens.light,palette.light,false),
            dark:colors(DEFAULT_CLASSIC_SKIN.tokens.dark,palette.dark,true),
            buttons:{light:{...DEFAULT_CLASSIC_SKIN.tokens.buttons.light,start:palette.light[2],hoverStart:palette.light[2],activeStart:palette.light[2],foreground:"#ffffff"},dark:{...DEFAULT_CLASSIC_SKIN.tokens.buttons.dark,start:palette.dark[2],hoverStart:palette.dark[2],activeStart:palette.dark[2],foreground:"#15191f"}},
        },
    };
    registerThemePack({id:palette.id,name:palette.name,skin});
}
