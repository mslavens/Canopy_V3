export const CHUNK_SIZE = 1024 * 1024; // 1 MB
export const LINE_BREAK = /\r?\n/;
export const CSV_SPLIT_REGEX = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/g;

export const fieldNamesMapping: Record<string, string[]> = {
    'Device Name': ['Device Name', 'Device'],
    'Serial #': ['Serial #', 'Serial Number'],
    'Rule': ['Rule', 'Name'],
    'Source User': ['Source User'],
    'Category': ['Category'],
    'Source Zone': ['Source Zone'],
    'Source address': ['Source address', 'Source Address'],
    'Destination Zone': ['Destination Zone'],
    'Destination address': ['Destination address', 'Destination Address'],
    'Application': ['Application'],
    'Destination Port': ['Destination Port', 'Service'],
    'IP Protocol': ['IP Protocol'],
    'Action': ['Action'],
    'Threat/Content Type': ['Threat/Content Type'],
    'Session End Reason': ['Session End Reason'],
    'NAT Source IP': ['NAT Source IP'],
    'NAT Destination IP': ['NAT Destination IP'],
    'Subcategory of app': ['Subcategory of app'],
    'Category of app': ['Category of app'],
    'Technology of app': ['Technology of app'],
    'Count': ['Count', 'Rule Usage Hit Count', 'Flow Count'],
    'Bytes': ['Bytes'],
    'Bytes Sent': ['Bytes Sent'],
    'Bytes Received': ['Bytes Received'],
    'Packets': ['Packets'],
    'Packets Sent': ['Packets Sent'],
    'Packets Received': ['Packets Received']
};

export const outputFieldnames = Object.keys(fieldNamesMapping);

export function parseLine(line: string, headers: string[]): string[] | null {
    const values = line.split(CSV_SPLIT_REGEX);
    const row: string[] = [];

    if (values.length < headers.length * 0.8 && values.length < 5) {
        return null;
    }

    for (let j = 0; j < values.length; j++) {
        let value = (values[j] !== undefined) ? values[j].trim() : '';
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.substring(1, value.length - 1);
        }
        value = value.replace(/""/g, '"');
        row.push(value);
    }
    return row;
}

export function preResolveHeaders(inputHeaders: string[]): Record<number, string | null> {
    const cacheObj: Record<number, string | null> = {};
    for (let j = 0; j < inputHeaders.length; j++) {
        const inputName = inputHeaders[j];
        let foundOutputName: string | null = null;

        for (const outputName of outputFieldnames) {
            const possibleNames = fieldNamesMapping[outputName];
            if (possibleNames.includes(inputName)) {
                foundOutputName = outputName;
                break;
            }
        }
        cacheObj[j] = foundOutputName;
    }
    return cacheObj;
}

export function guessMapping(fileHeaders: string[], targetFields: string[] = outputFieldnames): Record<string, string> {
    const mapping: Record<string, string> = {};
    
    for (const outputName of targetFields) {
        const possibleNames = fieldNamesMapping[outputName];
        let found: string | undefined = undefined;

        if (possibleNames) {
            found = fileHeaders.find(h => possibleNames.some(p => p.toLowerCase() === h.toLowerCase()));
            if (!found) {
                found = fileHeaders.find(h => possibleNames.some(p => h.toLowerCase().includes(p.toLowerCase())));
            }
        }

        mapping[outputName] = found || '';
        
        if (!possibleNames) {
             mapping[outputName] = fileHeaders.find(h => h.toLowerCase() === outputName.toLowerCase()) || '';
        }
    }
    return mapping;
}

export function createMappingFromSelection(fileHeaders: string[], userMapping: Record<string, string>): Record<number, string> {
    const cacheObj: Record<number, string> = {};
    for (let j = 0; j < fileHeaders.length; j++) {
        const header = fileHeaders[j];
        for (const [outputField, mappedHeader] of Object.entries(userMapping)) {
            if (mappedHeader === header) {
                cacheObj[j] = outputField;
                break;
            }
        }
    }
    return cacheObj;
}

export function processChunkData(rawData: string[][], mappingCache: Record<number, string>, targetFields: string[] = outputFieldnames): any[] {
    const chunkRowCounts = new Map<string, { count: number, metrics: Record<string, number> }>();
    const metricFields = ['Bytes', 'Bytes Sent', 'Bytes Received', 'Packets', 'Packets Sent', 'Packets Received'];
    const uniqueOutputFields = targetFields.filter(name => name !== 'Count' && !metricFields.includes(name));

    for (const rowValues of rawData) {
        const extractedRow: Record<string, any> = {};
        let count = 1;
        let nonNaFields = 0;

        for (let j = 0; j < rowValues.length; j++) {
            const outputFieldname = mappingCache[j];

            if (!outputFieldname) continue;

            let value: any = rowValues[j];
            value = value ? String(value).trim() : "";

            if (outputFieldname === 'Count') {
                try {
                    const parsedCount = parseFloat(value);
                    count = isNaN(parsedCount) ? (value || 1) : parsedCount;
                } catch (e) {
                    count = value || 1;
                }
            } else if (metricFields.includes(outputFieldname)) {
                extractedRow[outputFieldname] = parseFloat(value) || 0;
            } else {
                extractedRow[outputFieldname] = value || "na";
                if (value && value !== 'na') nonNaFields++;
            }
        }

        for (const outputFieldname of uniqueOutputFields) {
            if (!extractedRow.hasOwnProperty(outputFieldname)) {
                extractedRow[outputFieldname] = "na";
            }
        }

        if (nonNaFields === 0) continue;

        const rowKey = uniqueOutputFields.map(name => extractedRow[name]).join('|');

        let existing = chunkRowCounts.get(rowKey);
        if (existing !== undefined) {
            let existingNum = existing.count;
            let currentNum = typeof count === 'number' ? count : parseFloat(String(count));
            if (!isNaN(existingNum) && !isNaN(currentNum)) {
                existing.count = existingNum + currentNum;
            }
            metricFields.forEach(m => existing!.metrics[m] = (existing!.metrics[m] || 0) + (extractedRow[m] || 0));
        } else {
            const metrics: Record<string, number> = {};
            metricFields.forEach(m => metrics[m] = extractedRow[m] || 0);
            chunkRowCounts.set(rowKey, { count: typeof count === 'number' ? count : parseFloat(String(count)) || 1, metrics });
        }
    }

    const finalRows: any[] = [];
    for (const [rowKey, data] of chunkRowCounts.entries()) {
        const values = rowKey.split('|');
        const rowObj: Record<string, any> = {};
        let valueIndex = 0;
        for (const outputFieldname of uniqueOutputFields) {
            rowObj[outputFieldname] = values[valueIndex] !== undefined ? values[valueIndex] : "na";
            valueIndex++;
        }
        rowObj['Count'] = data.count;
        metricFields.forEach(m => rowObj[m] = data.metrics[m] || 0);
        finalRows.push(rowObj);
    }

    return finalRows;
}

export function unparseData(data: any[], targetFields: string[] = outputFieldnames): string {
    if (!data || data.length === 0) return "";
    
    let csv = targetFields.join(',') + '\n';

    data.forEach(row => {
        const values = targetFields.map(col => {
            let value = row[col];
            if (value === null || value === undefined) return "";
            value = String(value);
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csv += values.join(',') + '\n';
    });
    return csv;
}

export const dbFieldMapping: Record<string, string> = {
    'Device Name': 'deviceName',
    'Serial #': 'serial',
    'Rule': 'ruleName',
    'Source User': 'sourceUser',
    'Category': 'category',
    'Source Zone': 'sourceZone',
    'Source address': 'sourceIP',
    'Destination Zone': 'destZone',
    'Destination address': 'destIP',
    'Application': 'application',
    'Destination Port': 'service',
    'IP Protocol': 'protocol',
    'Action': 'action',
    'Threat/Content Type': 'threatType',
    'Session End Reason': 'sessionEndReason',
    'NAT Source IP': 'natSourceIp',
    'NAT Destination IP': 'natDestIp',
    'Subcategory of app': 'appSubcategory',
    'Category of app': 'appCategory',
    'Technology of app': 'appTechnology',
    'Count': 'count',
    'Bytes': 'bytes',
    'Bytes Sent': 'bytesSent',
    'Bytes Received': 'bytesReceived',
    'Packets': 'packets',
    'Packets Sent': 'packetsSent',
    'Packets Received': 'packetsReceived'
};
