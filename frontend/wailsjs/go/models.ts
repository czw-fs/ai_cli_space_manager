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
	
	    static createFrom(source: any = {}) {
	        return new Directory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.path = source["path"];
	        this.groupId = source["groupId"];
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
	    config: ConfigStatus;
	
	    static createFrom(source: any = {}) {
	        return new AppState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], Group);
	        this.directories = this.convertValues(source["directories"], Directory);
	        this.customOpeners = this.convertValues(source["customOpeners"], CustomOpener);
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

