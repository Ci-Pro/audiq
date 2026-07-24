"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Download,
  Music,
  Video,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Shield,
  Globe,
  Clock,
  ChevronDown,
  History,
  Trash2,
  FileAudio,
  FileVideo,
  AlertCircle,
  Sparkles,
  ArrowRight,
  Play,
  Pause,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Types
interface VideoInfo {
  videoId: string;
  title: string;
  thumbnail: string;
  duration: number;
  channel: string;
  durationString: string;
}

interface DownloadItem {
  id: string;
  url: string;
  title: string;
  thumbnail: string | null;
  duration: number | null;
  format: string;
  quality: string;
  status: string;
  progress: number;
  fileSize: number | null;
  createdAt: string;
  error?: string;
}

// Utility functions
function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ============ Components ============

function AnimatedBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Gradient orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-emerald-500/10 blur-[120px] animate-float" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] rounded-full bg-teal-500/8 blur-[100px] animate-float" style={{ animationDelay: "-3s" }} />
      <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] rounded-full bg-cyan-500/5 blur-[80px] animate-float" style={{ animationDelay: "-5s" }} />
      {/* Grid overlay */}
      <div className="absolute inset-0 bg-grid opacity-40" />
    </div>
  );
}

function FeatureCard({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <motion.div
      whileHover={{ y: -4, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <Card className="border-border/40 glass-subtle bg-card/50 hover:bg-card/80 transition-colors duration-300">
        <CardContent className="p-5 flex items-start gap-4">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
            <Icon className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function VideoPreviewCard({ video, isLoading }: { video: VideoInfo | null; isLoading: boolean }) {
  if (isLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
      >
        <Card className="border-border/40 glass-subtle bg-card/50 overflow-hidden">
          <CardContent className="p-0">
            <div className="flex flex-col sm:flex-row">
              <Skeleton className="w-full sm:w-64 h-36 sm:h-auto" />
              <div className="p-4 flex-1 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  }

  if (!video) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="border-border/40 glass-subtle bg-card/50 overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col sm:flex-row">
            <div className="relative w-full sm:w-64 h-36 sm:h-auto flex-shrink-0 bg-black/20">
              <img
                src={video.thumbnail}
                alt={video.title}
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-0.5 rounded text-xs font-medium text-white">
                {video.durationString || formatDuration(video.duration)}
              </div>
            </div>
            <div className="p-4 flex-1 min-w-0">
              <h3 className="font-semibold text-foreground text-sm line-clamp-2 leading-snug">{video.title}</h3>
              <p className="text-muted-foreground text-xs mt-1.5">{video.channel}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="text-[10px] px-2 py-0">
                  {video.durationString || formatDuration(video.duration)}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function FormatSelector({
  format,
  setFormat,
  quality,
  setQuality,
  mp4Qualities,
  mp3Qualities,
}: {
  format: string;
  setFormat: (f: string) => void;
  quality: string;
  setQuality: (q: string) => void;
  mp4Qualities: string[];
  mp3Qualities: string[];
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={format}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 10 }}
        className="flex flex-col sm:flex-row gap-3"
      >
        {/* Format Toggle */}
        <div className="flex gap-2">
          <Button
            variant={format === "mp4" ? "default" : "outline"}
            size="sm"
            className={cn(
              "gap-2 transition-all duration-300",
              format === "mp4"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20"
                : "border-border/60 hover:bg-accent/50"
            )}
            onClick={() => {
              setFormat("mp4");
              setQuality(mp4Qualities[1] || "720");
            }}
          >
            <Video className="w-4 h-4" />
            MP4
          </Button>
          <Button
            variant={format === "mp3" ? "default" : "outline"}
            size="sm"
            className={cn(
              "gap-2 transition-all duration-300",
              format === "mp3"
                ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-lg shadow-emerald-500/20"
                : "border-border/60 hover:bg-accent/50"
            )}
            onClick={() => {
              setFormat("mp3");
              setQuality(mp3Qualities[1] || "192");
            }}
          >
            <Music className="w-4 h-4" />
            MP3
          </Button>
        </div>

        {/* Quality Selector */}
        <Select value={quality} onValueChange={setQuality}>
          <SelectTrigger className="w-full sm:w-[180px] bg-card/50 border-border/40">
            <SelectValue placeholder="Select quality" />
          </SelectTrigger>
          <SelectContent className="bg-card border-border/40">
            {(format === "mp4" ? mp4Qualities : mp3Qualities).map((q) => (
              <SelectItem key={q} value={q} className="text-foreground">
                {format === "mp4" ? `${q}p` : `${q} kbps`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </motion.div>
    </AnimatePresence>
  );
}

function DownloadProgressItem({
  item,
  onCancel,
}: {
  item: DownloadItem;
  onCancel: (id: string) => void;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
    >
      <Card className="border-border/40 glass-subtle bg-card/50 overflow-hidden">
        <CardContent className="p-3">
          <div className="flex items-center gap-3">
            {/* Thumbnail */}
            <div className="w-16 h-10 rounded-md overflow-hidden flex-shrink-0 bg-black/20">
              {item.thumbnail ? (
                <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {item.format === "mp3" ? (
                    <FileAudio className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <FileVideo className="w-4 h-4 text-emerald-500" />
                  )}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border/40">
                  {item.format.toUpperCase()}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {item.format === "mp4" ? `${item.quality}p` : `${item.quality}kbps`}
                </span>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {item.status === "completed" && (
                <a href={`/api/download/${item.id}/file`} download>
                  <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs">
                    <Download className="w-3.5 h-3.5" />
                    Save
                  </Button>
                </a>
              )}
              {item.status === "processing" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-destructive hover:text-destructive"
                  onClick={() => onCancel(item.id)}
                >
                  Cancel
                </Button>
              )}
              {(item.status === "completed" || item.status === "failed") && item.fileSize && (
                <span className="text-[10px] text-muted-foreground">
                  {formatFileSize(item.fileSize)}
                </span>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {(item.status === "processing" || item.status === "completed") && (
            <div className="mt-2.5">
              <Progress
                value={item.status === "completed" ? 100 : item.progress}
                className="h-1.5 bg-muted/50"
              />
              <div className="flex items-center justify-between mt-1.5">
                {item.status === "processing" && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="w-3 h-3 text-emerald-500 animate-spin" />
                      <span className="text-[10px] text-muted-foreground">
                        Processing...
                      </span>
                    </div>
                    <span className="text-[10px] text-emerald-500 font-medium">
                      {item.progress.toFixed(1)}%
                    </span>
                  </>
                )}
                {item.status === "completed" && (
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    <span className="text-[10px] text-emerald-500 font-medium">Ready to download</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Error */}
          {item.status === "failed" && item.error && (
            <div className="mt-2 flex items-center gap-1.5">
              <AlertCircle className="w-3 h-3 text-destructive" />
              <span className="text-[10px] text-destructive">{item.error}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function HistoryItem({ item }: { item: DownloadItem }) {
  return (
    <Card className="border-border/30 bg-card/30 overflow-hidden hover:bg-card/50 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-center gap-3">
          <div className="w-12 h-8 rounded overflow-hidden flex-shrink-0 bg-black/10">
            {item.thumbnail ? (
              <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                {item.format === "mp3" ? (
                  <FileAudio className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <FileVideo className="w-3 h-3 text-muted-foreground" />
                )}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground truncate">{item.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <Badge variant="outline" className="text-[9px] px-1 py-0 border-border/30">
                {item.format.toUpperCase()}
              </Badge>
              <span className="text-[9px] text-muted-foreground">
                {formatDate(item.createdAt)}
              </span>
              {item.fileSize && (
                <span className="text-[9px] text-muted-foreground">
                  · {formatFileSize(item.fileSize)}
                </span>
              )}
            </div>
          </div>
          {item.status === "completed" && (
            <a href={`/api/download/${item.id}/file`} download>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-emerald-500 hover:text-emerald-600">
                <Download className="w-3.5 h-3.5" />
              </Button>
            </a>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Main Page ============

export default function Home() {
  const [url, setUrl] = useState("");
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [isLoadingVideo, setIsLoadingVideo] = useState(false);
  const [format, setFormat] = useState("mp4");
  const [quality, setQuality] = useState("720");
  const [activeDownloads, setActiveDownloads] = useState<DownloadItem[]>([]);
  const [history, setHistory] = useState<DownloadItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const pollingRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  const mp4Qualities = ["360", "480", "720", "1080"];
  const mp3Qualities = ["128", "192", "320"];

  // Poll for download status updates
  const startPolling = useCallback((id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/download/${id}`);
        if (!res.ok) return;
        const data = await res.json();

        setActiveDownloads((prev) =>
          prev.map((d) =>
            d.id === id
              ? {
                  ...d,
                  status: data.status,
                  progress: data.progress,
                  fileSize: data.fileSize || d.fileSize,
                  error: data.error,
                }
              : d
          )
        );

        // Stop polling when done
        if (data.status === "completed") {
          clearInterval(interval);
          pollingRef.current.delete(id);
          toast.success("Download ready!", {
            description: "Your file is ready to download.",
          });
          fetchHistory();
        } else if (data.status === "failed") {
          clearInterval(interval);
          pollingRef.current.delete(id);
          if (data.error && data.error !== "Cancelled") {
            toast.error("Download failed", {
              description: data.error,
            });
          }
        }
      } catch {
        // silent fail
      }
    }, 2000);
    pollingRef.current.set(id, interval);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current.forEach((interval) => clearInterval(interval));
    };
  }, []);

  // Fetch history on mount
  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch("/api/history");
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch {
      // silent fail
    }
  };

  const extractVideoId = (inputUrl: string): string | null => {
    const match = inputUrl.match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
    );
    return match ? match[1] : null;
  };

  const handleFetchVideoInfo = useCallback(async () => {
    const videoId = extractVideoId(url);
    if (!videoId) {
      toast.error("Invalid URL", {
        description: "Please enter a valid YouTube URL.",
      });
      return;
    }

    setIsLoadingVideo(true);
    setVideoInfo(null);
    setHasStarted(true);

    try {
      const res = await fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Failed to fetch video info");
      }

      const data = await res.json();
      setVideoInfo(data);
    } catch (error: any) {
      toast.error("Error", {
        description: error.message || "Failed to fetch video info. Please check the URL.",
      });
    } finally {
      setIsLoadingVideo(false);
    }
  }, [url]);

  const handleStartDownload = useCallback(async () => {
    if (!videoInfo) return;

    setIsConverting(true);

    try {
      // Create download task in database
      const res = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          format,
          quality,
          title: videoInfo.title,
          thumbnail: videoInfo.thumbnail,
          duration: videoInfo.duration,
          channel: videoInfo.channel,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to create download task");
      }

      const taskData = await res.json();

      // Add to active downloads
      const newDownload: DownloadItem = {
        id: taskData.id,
        url,
        title: videoInfo.title,
        thumbnail: videoInfo.thumbnail,
        duration: videoInfo.duration,
        format,
        quality,
        status: "processing",
        progress: 0,
        fileSize: null,
        createdAt: new Date().toISOString(),
      };

      setActiveDownloads((prev) => [newDownload, ...prev]);

      // Start download via worker proxy API
      fetch("/api/worker/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: taskData.id,
          url,
          format,
          quality,
        }),
      }).catch(() => {
        toast.error("Error", { description: "Failed to start download worker." });
      });

      // Start polling for progress
      startPolling(taskData.id);

      toast.info("Download started", {
        description: `Converting to ${format.toUpperCase()} ${format === "mp4" ? `${quality}p` : `${quality}kbps`}...`,
      });

      // Reset form
      setUrl("");
      setVideoInfo(null);
      inputRef.current?.focus();
    } catch (error: any) {
      toast.error("Error", {
        description: error.message || "Failed to start download.",
      });
    } finally {
      setIsConverting(false);
    }
  }, [videoInfo, url, format, quality]);

  const handleCancelDownload = useCallback((id: string) => {
    fetch(`/api/worker/cancel/${id}`, { method: "POST" }).catch(() => {});
    setActiveDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: "failed", error: "Cancelled" } : d))
    );
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      if (extractVideoId(text)) {
        // Auto-fetch if valid URL
        setTimeout(() => handleFetchVideoInfo(), 100);
      }
    } catch {
      // Clipboard access denied
    }
  }, [handleFetchVideoInfo]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !videoInfo && url) {
        handleFetchVideoInfo();
      }
    },
    [handleFetchVideoInfo, url, videoInfo]
  );

  const completedCount = history.filter((h) => h.status === "completed").length;

  return (
    <div className="min-h-screen flex flex-col relative">
      <AnimatedBackground />

      {/* Header */}
      <header className="relative z-10 py-4 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Zap className="w-5 h-5 text-white" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight">VortexTube</span>
          </div>

          <div className="flex items-center gap-3">
            {history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History className="w-4 h-4" />
                <span className="hidden sm:inline">History</span>
                {completedCount > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1.5">
                    {completedCount}
                  </Badge>
                )}
                <ChevronDown className={cn("w-3 h-3 transition-transform", showHistory && "rotate-180")} />
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 px-6 pb-20">
        <div className="max-w-5xl mx-auto">
          {/* Hero Section */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="text-center mt-8 sm:mt-14 mb-10"
          >
            <motion.div
              initial={{ scale: 0.9 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 mb-6"
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs font-medium text-emerald-500">Free & Unlimited Downloads</span>
            </motion.div>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground leading-[1.1]">
              YouTube to{" "}
              <span className="bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
                MP3 & MP4
              </span>
            </h1>
            <p className="mt-4 text-base sm:text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
              Convert and download any YouTube video in seconds. High quality, fast processing, no registration needed.
            </p>
          </motion.div>

          {/* URL Input Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <Card className="border-border/40 glass-subtle bg-card/60 glow-primary overflow-hidden">
              <CardContent className="p-4 sm:p-6">
                {/* URL Input */}
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <Input
                      ref={inputRef}
                      type="url"
                      placeholder="Paste YouTube URL here..."
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      onKeyDown={handleKeyDown}
                      className="h-12 sm:h-14 bg-background/50 border-border/40 pl-12 text-sm sm:text-base placeholder:text-muted-foreground/50 focus:border-emerald-500/50 focus:ring-emerald-500/20 transition-all"
                    />
                    <div className="absolute left-4 top-1/2 -translate-y-1/2">
                      <Globe className="w-4.5 h-4.5 text-muted-foreground" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-12 sm:h-14 px-3 border-border/40 hover:bg-accent/50"
                      onClick={handlePaste}
                    >
                      Paste
                    </Button>
                    <Button
                      size="sm"
                      className="h-12 sm:h-14 px-5 sm:px-8 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium shadow-lg shadow-emerald-500/20 transition-all"
                      onClick={handleFetchVideoInfo}
                      disabled={!url || isLoadingVideo}
                    >
                      {isLoadingVideo ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : hasStarted ? (
                        "Fetch"
                      ) : (
                        <span className="flex items-center gap-2">
                          Analyze
                          <ArrowRight className="w-4 h-4" />
                        </span>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Video Preview */}
                <AnimatePresence>
                  {(videoInfo || isLoadingVideo) && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4">
                        <VideoPreviewCard video={videoInfo} isLoading={isLoadingVideo} />
                      </div>

                      {/* Format Selection + Download Button */}
                      {!isLoadingVideo && videoInfo && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                        >
                          <FormatSelector
                            format={format}
                            setFormat={setFormat}
                            quality={quality}
                            setQuality={setQuality}
                            mp4Qualities={mp4Qualities}
                            mp3Qualities={mp3Qualities}
                          />

                          <Button
                            size="lg"
                            className="gap-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-semibold shadow-xl shadow-emerald-500/25 transition-all hover:shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.98]"
                            onClick={handleStartDownload}
                            disabled={isConverting}
                          >
                            {isConverting ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Starting...
                              </>
                            ) : (
                              <>
                                <Download className="w-5 h-5" />
                                Convert & Download
                              </>
                            )}
                          </Button>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
          </motion.div>

          {/* Active Downloads */}
          <AnimatePresence>
            {activeDownloads.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6"
              >
                <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Active Downloads
                </h2>
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {activeDownloads
                      .filter((d) => d.status !== "completed")
                      .map((item) => (
                        <DownloadProgressItem key={item.id} item={item} onCancel={handleCancelDownload} />
                      ))}
                  </AnimatePresence>
                </div>

                {/* Completed Items */}
                {activeDownloads.some((d) => d.status === "completed") && (
                  <div className="mt-3">
                    <div className="space-y-2">
                      <AnimatePresence mode="popLayout">
                        {activeDownloads
                          .filter((d) => d.status === "completed")
                          .map((item) => (
                            <DownloadProgressItem key={item.id} item={item} onCancel={handleCancelDownload} />
                          ))}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Features Section */}
          {!hasStarted && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="mt-14"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FeatureCard
                  icon={Zap}
                  title="Lightning Fast"
                  description="Convert videos in seconds with our optimized processing engine. No waiting, instant results."
                />
                <FeatureCard
                  icon={Shield}
                  title="Safe & Private"
                  description="No registration required. Your data stays private. No tracking, no ads, no malware."
                />
                <FeatureCard
                  icon={Music}
                  title="High Quality"
                  description="Download in up to 1080p for video and 320kbps for audio. Choose the quality that suits you."
                />
              </div>
            </motion.div>
          )}

          {/* History Panel */}
          <AnimatePresence>
            {showHistory && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="mt-6"
              >
                <Card className="border-border/40 glass-subtle bg-card/50 overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                        <History className="w-4 h-4" />
                        Download History
                      </h2>
                      {history.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {history.length} items
                        </span>
                      )}
                    </div>

                    {history.length === 0 ? (
                      <div className="text-center py-8">
                        <Clock className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground">No downloads yet</p>
                        <p className="text-xs text-muted-foreground/60 mt-1">Your download history will appear here</p>
                      </div>
                    ) : (
                      <ScrollArea className="max-h-96">
                        <div className="space-y-1.5">
                          {history.map((item) => (
                            <HistoryItem key={item.id} item={item} />
                          ))}
                        </div>
                      </ScrollArea>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 mt-auto border-t border-border/30">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Zap className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-sm font-medium text-foreground">VortexTube</span>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              For personal use only. Respect copyright and intellectual property rights.
            </p>
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} VortexTube
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
