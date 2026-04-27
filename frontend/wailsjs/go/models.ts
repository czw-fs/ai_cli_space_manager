export namespace attachment {
	
	export class FileInfo {
	    id: string;
	    name: string;
	    path: string;
	    mimeType: string;
	    size: number;
	
	    static createFrom(source: any = {}) {
	        return new FileInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.mimeType = source["mimeType"];
	        this.size = source["size"];
	    }
	}
	export class SaveRequest {
	    sessionId: string;
	    fileName: string;
	    mimeType: string;
	    dataBase64: string;
	    attachmentRootPath: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.fileName = source["fileName"];
	        this.mimeType = source["mimeType"];
	        this.dataBase64 = source["dataBase64"];
	        this.attachmentRootPath = source["attachmentRootPath"];
	    }
	}

}

export namespace config {
	
	export class ConfigStatus {
	    configExists: boolean;
	    configPath: string;
	    configError: string;
	    usingDefaults: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ConfigStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.configExists = source["configExists"];
	        this.configPath = source["configPath"];
	        this.configError = source["configError"];
	        this.usingDefaults = source["usingDefaults"];
	    }
	}
	export class ColumnWidths {
	    search: number;
	    name: number;
	    group: number;
	    path: number;
	    actions: number;
	    manage: number;
	
	    static createFrom(source: any = {}) {
	        return new ColumnWidths(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.search = source["search"];
	        this.name = source["name"];
	        this.group = source["group"];
	        this.path = source["path"];
	        this.actions = source["actions"];
	        this.manage = source["manage"];
	    }
	}
	export class UISettings {
	    columnWidths: ColumnWidths;
	    powerShellLaunchMode: string;
	    enterKeyMode: string;
	    attachmentRootPath: string;
	    theme: string;
	    sidebarWidth: number;
	    composerHeight: number;
	
	    static createFrom(source: any = {}) {
	        return new UISettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columnWidths = this.convertValues(source["columnWidths"], ColumnWidths);
	        this.powerShellLaunchMode = source["powerShellLaunchMode"];
	        this.enterKeyMode = source["enterKeyMode"];
	        this.attachmentRootPath = source["attachmentRootPath"];
	        this.theme = source["theme"];
	        this.sidebarWidth = source["sidebarWidth"];
	        this.composerHeight = source["composerHeight"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CustomOpener {
	    id: string;
	    name: string;
	    commandTemplate: string;
	
	    static createFrom(source: any = {}) {
	        return new CustomOpener(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.commandTemplate = source["commandTemplate"];
	    }
	}
	export class Directory {
	    id: string;
	    name: string;
	    path: string;
	    groupId: string;
	    openerIds?: string[];
	
	    static createFrom(source: any = {}) {
	        return new Directory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.groupId = source["groupId"];
	        this.openerIds = source["openerIds"];
	    }
	}
	export class Group {
	    id: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	    }
	}
	export class AppState {
	    groups: Group[];
	    directories: Directory[];
	    customOpeners: CustomOpener[];
	    ui: UISettings;
	    config: ConfigStatus;
	
	    static createFrom(source: any = {}) {
	        return new AppState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], Group);
	        this.directories = this.convertValues(source["directories"], Directory);
	        this.customOpeners = this.convertValues(source["customOpeners"], CustomOpener);
	        this.ui = this.convertValues(source["ui"], UISettings);
	        this.config = this.convertValues(source["config"], ConfigStatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	

}

export namespace terminal {
	
	export class SessionInfo {
	    id: string;
	    title: string;
	    directory: string;
	    running: boolean;
	    createdAt: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.directory = source["directory"];
	        this.running = source["running"];
	        this.createdAt = source["createdAt"];
	    }
	}

}

