import React, { useState, useEffect, useCallback, useRef } from 'react';
import DeckGL from '@deck.gl/react';
import { ScatterplotLayer, PathLayer } from '@deck.gl/layers';
import { OrthographicView, OrthographicController } from '@deck.gl/core';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Download, X, Upload } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface RocketData {
  id: string;
  latentx1: number;
  latentx2: number;
  design_var_1: string;
  design_var_2: string;
  feasible: boolean;
}

interface ViewState {
  target: [number, number, number];
  zoom: number;
  bounds?: [number, number, number, number];
}

const RocketVisualization: React.FC = () => {
  const [data, setData] = useState<RocketData[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewState, setViewState] = useState<ViewState>({
    target: [0, 0, 0],
    zoom: 0
  });
  
  // Controls state
  const [pointSize, setPointSize] = useState(4);
  const [pointOpacity, setPointOpacity] = useState(140);
  const [showGrid, setShowGrid] = useState(true);
  const [gridStep, setGridStep] = useState<number | null>(null);
  
  // Selection state
  const [selected, setSelected] = useState<Map<string, RocketData>>(new Map());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionBounds, setSelectionBounds] = useState<{
    startX: number;
    startY: number;
    endX: number;
    endY: number;
  } | null>(null);
  
  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    object: RocketData;
  } | null>(null);
  
  const deckRef = useRef<any>(null);

  // Color constants
  const FEASIBLE_COLOR = [34, 197, 94, 255]; // green
  const INFEASIBLE_COLOR = [239, 68, 68, 255]; // red

  const parseCSV = (text: string): RocketData[] => {
    const delim = text.includes('\t') ? '\t' : (text.includes(';') ? ';' : ',');
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    
    const headers = lines[0].split(delim).map(h => h.trim());
    const lower = headers.map(h => h.toLowerCase());
    
    const ix = lower.indexOf('latentx1');
    const iy = lower.indexOf('latentx2');
    if (ix < 0 || iy < 0) {
      throw new Error("CSV must include 'latentx1' and 'latentx2' columns");
    }
    
    const iid = lower.indexOf('id');
    const idv1 = lower.indexOf('design_var_1');
    const idv2 = lower.indexOf('design_var_2');
    const ifeas = lower.indexOf('feasible');
    
    const rows: RocketData[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(delim).map(s => s.trim());
      const x = parseFloat(cols[ix]);
      const y = parseFloat(cols[iy]);
      
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      
      const rawFeas = ifeas >= 0 ? (cols[ifeas] ?? '') : '';
      const feasible = /^true|1$/i.test(String(rawFeas).trim());
      
      rows.push({
        id: iid >= 0 ? cols[iid] : String(i - 1),
        latentx1: x,
        latentx2: y,
        design_var_1: idv1 >= 0 ? cols[idv1] : '',
        design_var_2: idv2 >= 0 ? cols[idv2] : '',
        feasible
      });
    }
    
    return rows;
  };

  const zoomToFit = (data: RocketData[], margin = 0.1): ViewState => {
    const xs = data.map(d => d.latentx1);
    const ys = data.map(d => d.latentx2);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    
    const w = Math.max(1e-9, maxX - minX);
    const h = Math.max(1e-9, maxY - minY);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const span = Math.max(w, h) * (1 + margin);
    const screenSpan = Math.min(vw, vh);
    const scale = screenSpan / span;
    const zoom = Math.log2(Math.max(scale, 1e-6));
    
    return {
      target: [cx, cy, 0],
      zoom,
      bounds: [minX, minY, maxX, maxY]
    };
  };

  const loadCSV = async () => {
    setLoading(true);
    try {
      const response = await fetch('/data/combined.csv', { cache: 'no-cache' });
      if (!response.ok) {
        throw new Error('CSV not found at /data/combined.csv. Please ensure the file exists.');
      }
      
      const text = await response.text();
      const parsedData = parseCSV(text);
      setData(parsedData);
      
      const newViewState = zoomToFit(parsedData);
      setViewState(newViewState);
      
      toast({
        title: "Data loaded successfully",
        description: `Loaded ${parsedData.length} rocket designs`,
      });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : 'Failed to load CSV';
      toast({
        title: "Error loading data",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const buildGridPaths = (bounds: [number, number, number, number], step?: number) => {
    const [minX, minY, maxX, maxY] = bounds;
    const dx = maxX - minX;
    const dy = maxY - minY;
    const safeStep = step || Math.max(dx, dy) / 10;
    
    const startX = Math.floor(minX / safeStep) * safeStep;
    const endX = Math.ceil(maxX / safeStep) * safeStep;
    const startY = Math.floor(minY / safeStep) * safeStep;
    const endY = Math.ceil(maxY / safeStep) * safeStep;
    
    const lines = [];
    let count = 0;
    const MAX = 400;
    
    for (let x = startX; x <= endX + 1e-9; x += safeStep) {
      lines.push({
        path: [[x, startY], [x, endY]],
        major: Math.abs((x / safeStep) % 5) < 1e-9
      });
      if (++count > MAX) break;
    }
    
    for (let y = startY; y <= endY + 1e-9; y += safeStep) {
      lines.push({
        path: [[startX, y], [endX, y]],
        major: Math.abs((y / safeStep) % 5) < 1e-9
      });
      if (++count > MAX * 2) break;
    }
    
    return lines;
  };

  const layers = React.useMemo(() => {
    const layerList = [];
    
    // Grid layer
    if (showGrid && viewState.bounds) {
      const gridLines = buildGridPaths(viewState.bounds, gridStep || undefined);
      layerList.push(
        new PathLayer({
          id: 'grid-lines',
          data: gridLines,
          pickable: false,
          getPath: (d: any) => d.path,
          getColor: (d: any) => d.major ? [120, 120, 120, 140] : [180, 180, 180, 90],
          widthUnits: 'pixels',
          getWidth: (d: any) => d.major ? 2 : 1,
          parameters: { depthTest: false }
        })
      );
    }
    
    // Scatter plot layer
    layerList.push(
      new ScatterplotLayer({
        id: 'rockets',
        data,
        pickable: true,
        radiusUnits: 'pixels',
        getRadius: pointSize,
        getFillColor: (d: RocketData) => 
          d.feasible ? [...FEASIBLE_COLOR.slice(0, 3), pointOpacity] : [...INFEASIBLE_COLOR.slice(0, 3), pointOpacity],
        getLineColor: [255, 255, 255, 180],
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        getPosition: (d: RocketData) => [d.latentx1, d.latentx2],
        onHover: ({ x, y, object }) => {
          if (object) {
            setTooltip({ x, y, object });
          } else {
            setTooltip(null);
          }
        }
      })
    );
    
    return layerList;
  }, [data, pointSize, pointOpacity, showGrid, gridStep, viewState.bounds]);

  const handleSelectionExport = () => {
    if (selected.size === 0) return;
    
    const rows = [['id', 'latentx1', 'latentx2', 'design_var_1', 'design_var_2', 'feasible']];
    selected.forEach(d => {
      rows.push([d.id, d.latentx1.toString(), d.latentx2.toString(), d.design_var_1, d.design_var_2, d.feasible.toString()]);
    });
    
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rocket_selection.csv';
    a.click();
    URL.revokeObjectURL(url);
    
    toast({
      title: "Export complete",
      description: `Exported ${selected.size} selected items`,
    });
  };

  const clearSelection = () => {
    setSelected(new Map());
    setSelectionBounds(null);
  };

  const selectedArray = Array.from(selected.values());

  return (
    <div className="h-screen w-full bg-space relative overflow-hidden">
      {/* Top Control Bar */}
      <Card className="absolute top-4 left-4 z-20 bg-card/90 backdrop-blur-sm border-border/50">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <Button 
              onClick={loadCSV} 
              disabled={loading}
              variant="default"
              className="bg-rocket text-primary-foreground hover:bg-rocket/90"
            >
              <Upload className="w-4 h-4 mr-2" />
              {loading ? 'Loading...' : 'Load CSV'}
            </Button>
            
            <div className="flex items-center gap-2">
              <Label htmlFor="pointSize" className="text-sm">Size</Label>
              <Slider
                id="pointSize"
                min={1}
                max={12}
                step={1}
                value={[pointSize]}
                onValueChange={(value) => setPointSize(value[0])}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground w-6">{pointSize}</span>
            </div>
            
            <div className="flex items-center gap-2">
              <Label htmlFor="opacity" className="text-sm">Opacity</Label>
              <Slider
                id="opacity"
                min={30}
                max={255}
                step={5}
                value={[pointOpacity]}
                onValueChange={(value) => setPointOpacity(value[0])}
                className="w-20"
              />
              <span className="text-sm text-muted-foreground w-8">{pointOpacity}</span>
            </div>
            
            <div className="flex items-center gap-2">
              <Checkbox
                id="showGrid"
                checked={showGrid}
                onCheckedChange={(checked) => setShowGrid(!!checked)}
              />
              <Label htmlFor="showGrid" className="text-sm">Grid</Label>
            </div>
            
            <div className="flex items-center gap-2">
              <Label htmlFor="gridStep" className="text-sm">Step</Label>
              <Input
                id="gridStep"
                type="number"
                step="0.1"
                placeholder="auto"
                value={gridStep || ''}
                onChange={(e) => setGridStep(e.target.value ? parseFloat(e.target.value) : null)}
                className="w-20"
              />
            </div>
            
            <div className="text-sm text-muted-foreground">
              Hold <kbd className="px-1 py-0.5 bg-muted rounded text-xs">Shift</kbd> + drag to select
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Legend */}
      <Card className="absolute bottom-44 left-4 z-10 bg-card/90 backdrop-blur-sm border-border/50">
        <CardContent className="p-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-feasible-green"></div>
              <span className="text-sm">Feasible</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-infeasible-red"></div>
              <span className="text-sm">Infeasible</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Visualization */}
      <DeckGL
        ref={deckRef}
        views={[new OrthographicView({ id: 'ortho' })]}
        controller={{ type: OrthographicController, inertia: true }}
        viewState={viewState}
        onViewStateChange={({ viewState }) => setViewState(viewState)}
        layers={layers}
        getCursor={() => isSelecting ? 'crosshair' : 'grab'}
      />

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute pointer-events-none z-30 bg-popover border border-border rounded-lg p-3 shadow-lg max-w-xs"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            transform: 'translate(0, -100%)'
          }}
        >
          <img
            src={`/sprites/default_rocket.svg`}
            alt="Rocket sprite"
            className="w-32 h-32 object-contain mb-2 bg-muted rounded border"
          />
          <div className="space-y-1 text-sm">
            <div><strong>ID:</strong> {tooltip.object.id}</div>
            <div><strong>Design Var 1:</strong> {tooltip.object.design_var_1}</div>
            <div><strong>Design Var 2:</strong> {tooltip.object.design_var_2}</div>
            <div className="text-muted-foreground">
              x={tooltip.object.latentx1.toFixed(3)}, y={tooltip.object.latentx2.toFixed(3)}
            </div>
          </div>
        </div>
      )}

      {/* Bottom Selection Panel */}
      <Card className="absolute bottom-0 left-0 right-0 h-40 z-15 bg-card border-t border-border rounded-none rounded-t-lg">
        <CardHeader className="py-3 px-4 border-b border-border">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">
              Selection <Badge variant="secondary" className="ml-2">
                {selected.size}
              </Badge>
            </CardTitle>
            <div className="flex gap-2">
              <Button
                onClick={handleSelectionExport}
                disabled={selected.size === 0}
                size="sm"
                variant="outline"
              >
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button
                onClick={clearSelection}
                disabled={selected.size === 0}
                size="sm"
                variant="outline"
              >
                <X className="w-4 h-4 mr-2" />
                Clear
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 h-full overflow-hidden">
          <div className="flex gap-3 p-4 overflow-x-auto h-full">
            {selectedArray.length === 0 ? (
              <div className="flex items-center justify-center w-full text-muted-foreground">
                No selection. Hold Shift and drag to select points.
              </div>
            ) : (
              selectedArray.slice(0, 50).map((item) => (
                <Card key={item.id} className="flex-shrink-0 w-64 h-24 bg-muted/50">
                  <CardContent className="p-3 h-full">
                    <div className="flex gap-3 h-full">
                      <div
                        className={`w-2 h-full rounded-full ${
                          item.feasible ? 'bg-feasible-green' : 'bg-infeasible-red'
                        }`}
                      />
                      <img
                        src={`/sprites/default_rocket.svg`}
                        alt="Rocket"
                        className="w-16 h-16 object-contain bg-background rounded border"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">ID: {item.id}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          x={item.latentx1.toFixed(2)}, y={item.latentx2.toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          v1={item.design_var_1} · v2={item.design_var_2}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RocketVisualization;