'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './page.module.css';
import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';

// 定义骨骼连接
const POSE_CONNECTIONS = [
  // 躯干
  [11, 12], // 肩膀
  [11, 23], // 左躯干
  [12, 24], // 右躯干
  [23, 24], // 臀部
  // 左臂
  [11, 13], // 左上臂
  [13, 15], // 左前臂
  // 右臂
  [12, 14], // 右上臂
  [14, 16], // 右前臂
  // 左腿
  [23, 25], // 左大腿
  [25, 27], // 左小腿
  // 右腿
  [24, 26], // 右大腿
  [26, 28], // 右小腿
];

declare global {
  interface Window {
    Pose: any;
  }
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const skeletonCanvasRef = useRef<HTMLCanvasElement>(null);
  const [pixelSize, setPixelSize] = useState<number>(10);
  const [isStreamStarted, setIsStreamStarted] = useState<boolean>(false);
  const animationFrameIdRef = useRef<number | undefined>(undefined);
  const poseRef = useRef<any>(undefined);

  // 初始化 MediaPipe Pose
  useEffect(() => {
    const initPose = async () => {
      await tf.setBackend('webgl');
      
      if (typeof window !== 'undefined' && window.Pose) {
        const pose = new window.Pose({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404/${file}`;
          }
        });

        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        pose.onResults(onResults);
        poseRef.current = pose;
      } else {
        console.error('MediaPipe Pose not loaded');
      }
    };

    const checkAndInit = () => {
      if (typeof window !== 'undefined' && window.Pose) {
        initPose();
      } else {
        setTimeout(checkAndInit, 100);
      }
    };

    checkAndInit();
  }, []);

  // 处理姿态检测结果
  const onResults = (results: any) => {
    const skeletonCanvas = skeletonCanvasRef.current;
    if (!skeletonCanvas || !results.poseLandmarks) return;

    const ctx = skeletonCanvas.getContext('2d');
    if (!ctx) return;

    // 清除上一帧
    ctx.clearRect(0, 0, skeletonCanvas.width, skeletonCanvas.height);

    // 绘制骨骼连接
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 4;
    ctx.fillStyle = '#FF0000';

    // 确保姿势数据存在
    if (results.poseLandmarks) {
      // 绘制连接线
      POSE_CONNECTIONS.forEach(([start, end]) => {
        const startPoint = results.poseLandmarks[start];
        const endPoint = results.poseLandmarks[end];

        if (startPoint && endPoint) {
          ctx.beginPath();
          ctx.moveTo(
            startPoint.x * skeletonCanvas.width,
            startPoint.y * skeletonCanvas.height
          );
          ctx.lineTo(
            endPoint.x * skeletonCanvas.width,
            endPoint.y * skeletonCanvas.height
          );
          ctx.stroke();
        }
      });

      // 绘制关键点
      results.poseLandmarks.forEach((landmark: any) => {
        ctx.beginPath();
        ctx.arc(
          landmark.x * skeletonCanvas.width,
          landmark.y * skeletonCanvas.height,
          5,
          0,
          2 * Math.PI
        );
        ctx.fill();
      });
    }
  };

  const applyMosaic = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 设置canvas尺寸与视频相同
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    if (skeletonCanvasRef.current) {
      skeletonCanvasRef.current.width = video.videoWidth;
      skeletonCanvasRef.current.height = video.videoHeight;
    }

    // 绘制原始视频帧
    ctx.drawImage(video, 0, 0);

    // 获取像素数据
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // 应用马赛克效果
    for (let y = 0; y < canvas.height; y += pixelSize) {
      for (let x = 0; x < canvas.width; x += pixelSize) {
        let r = 0, g = 0, b = 0;
        let count = 0;

        for (let dy = 0; dy < pixelSize && y + dy < canvas.height; dy++) {
          for (let dx = 0; dx < pixelSize && x + dx < canvas.width; dx++) {
            const index = ((y + dy) * canvas.width + (x + dx)) * 4;
            r += data[index];
            g += data[index + 1];
            b += data[index + 2];
            count++;
          }
        }

        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);

        for (let dy = 0; dy < pixelSize && y + dy < canvas.height; dy++) {
          for (let dx = 0; dx < pixelSize && x + dx < canvas.width; dx++) {
            const index = ((y + dy) * canvas.width + (x + dx)) * 4;
            data[index] = r;
            data[index + 1] = g;
            data[index + 2] = b;
          }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // 进行姿态检测
    if (poseRef.current) {
      await poseRef.current.send({ image: video });
    }

    animationFrameIdRef.current = requestAnimationFrame(applyMosaic);
  };

  useEffect(() => {
    let stream: MediaStream | null = null;

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            width: { ideal: 640 },
            height: { ideal: 480 }
          } 
        });
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setIsStreamStarted(true);
            // 开始渲染马赛克效果
            applyMosaic();
          };
        }
      } catch (err) {
        console.error('摄像头访问错误:', err);
      }
    };

    startCamera();

    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [pixelSize]);

  return (
    <main className="min-h-screen p-8 flex flex-col items-center gap-4">
      <h1 className="text-2xl font-bold mb-4">摄像头马赛克效果</h1>
      <div className="flex gap-4 items-start">
        <div className="relative">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="hidden"
          />
          <canvas
            ref={canvasRef}
            className={styles.canvas}
          />
        </div>
        <canvas
          ref={skeletonCanvasRef}
          className={styles.canvas}
        />
      </div>
      <div className="w-full max-w-md">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          马赛克密度: {pixelSize}px
        </label>
        <input
          type="range"
          min="2"
          max="30"
          value={pixelSize}
          onChange={(e) => setPixelSize(Number(e.target.value))}
          className="w-full"
        />
      </div>
      {!isStreamStarted && (
        <p className="text-red-500">正在等待摄像头权限...</p>
      )}
    </main>
  );
}
