import "jimp/browser/lib/jimp.js";
import "@tensorflow/tfjs-backend-webgl";
import {
  DownloadOutlined,
  FireOutlined,
  GithubOutlined,
  PlusCircleOutlined,
  SmileOutlined,
} from "@ant-design/icons";
import { closestCenter, DndContext } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  restrictToVerticalAxis,
  restrictToParentElement,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import * as mpFaceDetection from "@mediapipe/face_detection";
import * as tfjsWasm from "@tensorflow/tfjs-backend-wasm";
import * as faceDetection from "@tensorflow-models/face-detection";
import type { UploadProps } from "antd";
import {
  Alert,
  Card,
  Form,
  Radio,
  Switch,
  InputNumber,
  Button,
  Progress,
  Space,
  Typography,
  Upload,
  Modal,
  message,
} from "antd";
import { saveAs } from "file-saver";
import party from "party-js";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useState, useRef } from "react";

import InputImage from "./InputImage.tsx";
import { restrictToParentWithOffset } from "./lib/drag-modifiers.ts";
import {
  getDefaultGlasses,
  getEyesDistance,
  getGlassesSize,
  getNoseOffset,
  getRandomGlassesStyle,
} from "./lib/glasses.ts";
import { byId } from "./lib/id-utils.ts";
import { generateOutputFilename, getSuccessMessage } from "./lib/utils.ts";
import SortableGlassesItem from "./SortableGlassesItem.tsx";

const { Text, Link } = Typography;
const { Dragger } = Upload;

const EMOJI_GENERATION_START_MARK = "EmojiGenerationStartMark";
const EMOJI_GENERATION_END_MARK = "EmojiGenerationEndMark";

tfjsWasm.setWasmPaths(
  `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@${tfjsWasm.version_wasm}/dist/`,
);

let detector: faceDetection.FaceDetector;

async function loadFaceDetection() {
  detector = await faceDetection.createDetector(
    faceDetection.SupportedModels.MediaPipeFaceDetector,
    {
      runtime: "mediapipe",
      modelType: "short",
      maxFaces: 1,
      solutionPath: `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@${mpFaceDetection.VERSION}`,
    },
  );
}
loadFaceDetection();

function getDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });
}

function App() {
  const gifWorker = useMemo(
    () =>
      new Worker(new URL("./worker/gif.worker.ts", import.meta.url), {
        type: "module",
      }),
    [],
  );
  const [messageApi, contextHolder] = message.useMessage();
  const [status, setStatus] = useState<
    "START" | "LOADING" | "DETECTING" | "READY" | "GENERATING" | "DONE"
  >("START");
  const [successCount, setSuccessCount] = useState(0);
  const [inputFile, setInputFile] = useState<File>();
  const [inputImageDataUrl, setInputImageDataUrl] = useState("");
  const [outputImage, setOutputImage] = useState<Blob>();
  const [outputImageDataUrl, setOutputImageDataUrl] = useState("");
  const [glassesList, setGlassesList] = useState<Glasses[]>([]);
  const [imageOptions, setImageOptions] = useState<ImageOptions>({
    flipVertically: false,
    flipHorizontally: false,
  });
  const inputImageRef = useRef<null | HTMLImageElement>(null);
  const outputImageRef = useRef<null | HTMLImageElement>(null);
  const [mode, setMode] = useState<"NORMAL" | "HEDGEHOG">("NORMAL");
  const posthog = usePostHog();

  const [form] = Form.useForm();
  const lastFrameDelayEnabled = Form.useWatch(
    ["lastFrameDelay", "enabled"],
    form,
  );
  const numberOfLoops = Form.useWatch(["looping", "loops"], form);

  const [progressState, setProgressState] = useState(0);

  useEffect(() => {
    if (mode === "HEDGEHOG") {
      messageApi.info({
        content: "Hello fellow hedgehog fan!",
        icon: <span className="mr-1 text-lg">🦔</span>,
      });
    }
  }, [mode, messageApi]);

  gifWorker.onmessage = ({ data }) => {
    if (data.type === "PROGRESS") {
      setProgressState(Math.round(data.progress));
      return;
    }

    performance.mark(EMOJI_GENERATION_END_MARK);
    const emojiMeasure = performance.measure(
      "EmojiGeneration",
      EMOJI_GENERATION_START_MARK,
      EMOJI_GENERATION_END_MARK,
    );
    posthog?.capture("user_finished_emoji_generation", {
      duration: emojiMeasure.duration,
    });

    const { gifBlob, resultDataUrl } = data;
    setOutputImage(gifBlob);
    setOutputImageDataUrl(resultDataUrl);
    setSuccessCount(successCount + 1);
    setStatus("DONE");
  };

  function generateOutputImage() {
    if (!inputFile || !inputImageRef.current) {
      return;
    }

    const configurationOptions = form.getFieldsValue([
      ["looping"],
      ["lastFrameDelay"],
      ["frameDelay"],
      ["numberOfFrames"],
      ["size"],
    ]);

    posthog?.capture("user_started_emoji_generation", {
      ...configurationOptions,
    });

    performance.mark(EMOJI_GENERATION_START_MARK);

    gifWorker.postMessage({
      configurationOptions,
      glassesList: glassesList,
      imageOptions,
      inputImage: {
        renderedWidth: inputImageRef.current.width,
        renderedHeight: inputImageRef.current.height,
      },
      inputFile,
    });

    setProgressState(0);
    setStatus("GENERATING");
  }

  function renderOutputImage() {
    return (
      <div className="flex flex-col items-center">
        <img ref={outputImageRef} src={outputImageDataUrl} />
      </div>
    );
  }

  function renderFileInput() {
    const props: UploadProps = {
      className: "flex flex-1",
      name: "file",
      multiple: false,
      accept: "image/png, image/jpeg",
      showUploadList: false,
      customRequest: async (info) => {
        setStatus("LOADING");
        const selectedFile = info.file as File;
        setInputFile(selectedFile);
        const detectedMode = selectedFile.name.match(/(hedgehog|posthog)/gi)
          ? "HEDGEHOG"
          : "NORMAL";
        setMode(detectedMode);

        posthog?.capture("user_selected_input_file", {
          mode: detectedMode,
          fileType: selectedFile.type,
        });

        const selectedFileAsDataUrl = await getDataUrl(selectedFile);
        setInputImageDataUrl(selectedFileAsDataUrl);
        setStatus("DETECTING");
      },
    };
    return (
      <Dragger disabled={status === "LOADING"} {...props}>
        <p className="ant-upload-drag-icon">
          <SmileOutlined />
        </p>
        <p className="ant-upload-text">
          Click or drag file to this area to start!
        </p>
      </Dragger>
    );
  }

  function goBackToStart() {
    setStatus("START");
    setInputImageDataUrl("");
    setInputFile(undefined);
    setImageOptions({ flipVertically: false, flipHorizontally: false });
    setGlassesList([]);
  }

  function renderInputImage() {
    function handleRemoveInputImage() {
      posthog?.capture("user_removed_input_image");

      goBackToStart();
    }

    function handleInputImageError() {
      messageApi.warning(
        "The file could not be loaded - make sure it's a valid image file.",
      );
      posthog?.capture("user_uploaded_invalid_input_image");

      goBackToStart();
    }

    async function handleInputImageLoad() {
      if (!inputImageRef.current) {
        return;
      }
      const faces = await detector.estimateFaces(inputImageRef.current);
      if (faces.length === 0) {
        setGlassesList([getDefaultGlasses()]);
        setStatus("READY");
        return;
      }

      const scaleX =
        inputImageRef.current.width / inputImageRef.current.naturalWidth;
      const scaleY =
        inputImageRef.current.height / inputImageRef.current.naturalHeight;

      const newGlassesList: Glasses[] = [];
      for (const face of faces) {
        const newGlasses =
          faces.length === 1
            ? getDefaultGlasses()
            : getDefaultGlasses(getRandomGlassesStyle());
        const originalGlassesSize = getGlassesSize(newGlasses.styleUrl);
        const originalEyesDistance = getEyesDistance(newGlasses);
        const eyesDistance = Math.sqrt(
          Math.pow(scaleY * (face.keypoints[0].y - face.keypoints[1].y), 2) +
          Math.pow(scaleX * (face.keypoints[0].x - face.keypoints[1].x), 2),
        );
        const glassesScale = eyesDistance / originalEyesDistance;
        newGlasses.size.width = originalGlassesSize.width * glassesScale;
        newGlasses.size.height = originalGlassesSize.height * glassesScale;
        const noseX = face.keypoints[2].x;
        const noseY = Math.abs(face.keypoints[0].y - face.keypoints[1].y) / 2;
        const noseOffset = getNoseOffset(newGlasses);
        const glassesScaleX = newGlasses.size.width / originalGlassesSize.width;
        const glassesScaleY =
          newGlasses.size.height / originalGlassesSize.height;
        newGlasses.coordinates = {
          x: Math.abs(noseX * scaleX - noseOffset.x * glassesScaleX),
          y: Math.abs(
            (face.keypoints[0].y + noseY) * scaleY -
            noseOffset.y * glassesScaleY,
          ),
        };

        newGlassesList.push(newGlasses);
      }

      setGlassesList(newGlassesList);
      setStatus("READY");
    }

    function handleImageOptionsChange(
      event: React.MouseEvent<HTMLElement, MouseEvent>,
    ) {
      const field = event.currentTarget.dataset.field as string;
      function getNewValue() {
        if (field === "flipVertically" || field === "flipHorizontally") {
          return !imageOptions[field];
        }
      }
      setImageOptions(
        Object.assign({}, imageOptions, { [field as string]: getNewValue() }),
      );
    }

    function handleDragEnd({ delta, active }: DragEndEvent) {
      posthog?.capture("user_dragged_glasses");

      setGlassesList((currentGlassesList) => {
        const index = currentGlassesList.findIndex(byId(active.id as nanoId));
        if (index === -1) {
          return currentGlassesList;
        }
        const newGlassesList = [...currentGlassesList];
        const { x, y } = newGlassesList[index].coordinates;
        newGlassesList[index].coordinates = {
          x: x + delta.x,
          y: y + delta.y,
        };
        return newGlassesList;
      });
    }

    function renderGlassesItem(glasses: Glasses) {
      function handleGlassesDirectionChange(
        id: nanoId,
        direction: GlassesDirection,
      ) {
        const index = glassesList.findIndex(byId(id));
        if (index === -1) {
          return;
        }
        const newGlassesList = [...glassesList];
        newGlassesList[index].direction = direction;
        setGlassesList(newGlassesList);
      }
      function handleGlassesStyleChange(id: nanoId, styleUrl: string) {
        const index = glassesList.findIndex(byId(id));
        if (index === -1) {
          return;
        }
        const newGlassesList = [...glassesList];
        newGlassesList[index].styleUrl = styleUrl;
        setGlassesList(newGlassesList);
      }
      function handleGlassesFlipChange(
        event: React.MouseEvent<HTMLElement, MouseEvent>,
      ) {
        const id = event.currentTarget.dataset.id as nanoId;
        const index = glassesList.findIndex(byId(id));
        if (index === -1) {
          return;
        }
        const field = event.currentTarget.dataset.field as string;
        const newGlassesList = [...glassesList];
        if (field !== "flipHorizontally" && field !== "flipVertically") {
          return;
        }
        newGlassesList[index][field] = !newGlassesList[index][field];
        setGlassesList(newGlassesList);
      }
      function handleGlassesSelectionChange(
        event: React.MouseEvent<HTMLElement, MouseEvent>,
      ) {
        const id = event.currentTarget.dataset.id as nanoId;
        const index = glassesList.findIndex(byId(id));
        if (index === -1) {
          return;
        }
        let previouslySelectedId;
        const newGlassesList = glassesList.map((glasses) => {
          if (glasses.isSelected) {
            previouslySelectedId = glasses.id;
          }
          glasses.isSelected = false;
          return glasses;
        });
        if (previouslySelectedId !== id) {
          newGlassesList[index].isSelected = true;
        }
        setGlassesList(newGlassesList);
      }
      function handleRemoveGlasses(
        event: React.MouseEvent<HTMLElement, MouseEvent>,
      ) {
        const id = event.currentTarget.dataset.id as nanoId;
        const index = glassesList.findIndex(byId(id));
        if (index === -1) {
          return;
        }
        const newGlassesList = [...glassesList];
        newGlassesList.splice(index, 1);
        setGlassesList(newGlassesList);
      }
      return (
        <SortableGlassesItem
          key={glasses.id}
          glasses={glasses}
          onDirectionChange={handleGlassesDirectionChange}
          onFlipChange={handleGlassesFlipChange}
          onSelectionChange={handleGlassesSelectionChange}
          onStyleChange={handleGlassesStyleChange}
          onRemove={handleRemoveGlasses}
        />
      );
    }

    function handleGlassesSizeChange(id: nanoId, size: Size) {
      const index = glassesList.findIndex(byId(id));
      if (index === -1) {
        return;
      }
      const newGlassesList = [...glassesList];
      newGlassesList[index].size = size;
      setGlassesList(newGlassesList);
    }

    function handleGlassesItemDragEnd({ active, over }: DragEndEvent) {
      const oldId = active.id as nanoId;
      const newId = over?.id as nanoId;
      const oldIndex = glassesList.findIndex(byId(oldId));
      const newIndex = glassesList.findIndex(byId(newId));
      if (oldIndex === -1 || newIndex === -1) {
        return;
      }
      const newGlassesList = arrayMove(glassesList, oldIndex, newIndex);
      setGlassesList(newGlassesList);
    }

    function handleAddGlasses() {
      const newGlassesList = [...glassesList];
      newGlassesList.push(getDefaultGlasses());
      setGlassesList(newGlassesList);
    }

    const cardStyles = {
      body: {
        padding: 0,
      },
    };

    return (
      <>
        <DndContext
          onDragEnd={handleDragEnd}
          modifiers={[restrictToParentWithOffset]}
        >
          <InputImage
            imageOptions={imageOptions}
            inputImageDataUrl={inputImageDataUrl}
            inputImageRef={inputImageRef}
            glassesList={glassesList}
            onGlassesSizeChange={handleGlassesSizeChange}
            onInputImageError={handleInputImageError}
            onInputImageLoad={handleInputImageLoad}
            onImageOptionsChange={handleImageOptionsChange}
            onRemoveInputImage={handleRemoveInputImage}
          />
        </DndContext>
        <Card
          className="mt-2"
          size="small"
          title="Glasses"
          styles={cardStyles}
          loading={status === "DETECTING"}
          extra={
            <Button
              size="small"
              icon={<PlusCircleOutlined />}
              onClick={handleAddGlasses}
            >
              Add
            </Button>
          }
        >
          <DndContext
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            collisionDetection={closestCenter}
            onDragEnd={handleGlassesItemDragEnd}
          >
            <SortableContext
              items={glassesList}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {glassesList.map(renderGlassesItem)}
                {glassesList.length === 0 && (
                  <Alert
                    className="rounded-b-md"
                    banner
                    message="No glasses!?"
                    description="How can you deal with it without any glasses? How about adding at least one pair?"
                    type="warning"
                    action={
                      <Button
                        size="small"
                        icon={<PlusCircleOutlined />}
                        onClick={handleAddGlasses}
                      >
                        Add
                      </Button>
                    }
                  />
                )}
              </ul>
            </SortableContext>
          </DndContext>
        </Card>
      </>
    );
  }

  function renderForm() {
    return (
      <Form
        form={form}
        layout="vertical"
        disabled={status !== "READY"}
        initialValues={
          {
            numberOfFrames: 15,
            frameDelay: 100,
            lastFrameDelay: { enabled: true, value: 1000 },
            looping: { mode: "infinite", loops: 5 },
            size: 160,
          } as ConfigurationOptions
        }
      >
        <Form.Item label="Loops" name={["looping", "mode"]}>
          <Radio.Group>
            <Space direction="vertical">
              <Radio value="infinite">Infinite</Radio>
              <Radio value="off">Off</Radio>
              <Radio value="finite">
                <Form.Item name={["looping", "loops"]} noStyle>
                  <InputNumber
                    min={1}
                    addonAfter={numberOfLoops === 1 ? "loop" : "loops"}
                  />
                </Form.Item>
              </Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          label="Number of frames"
          tooltip="How many frames should be rendered - more frames, smoother motion, but bigger file size."
          name="numberOfFrames"
        >
          <InputNumber addonAfter="frames" style={{ width: "100%" }} min={2} />
        </Form.Item>
        <Form.Item
          label="Frame delay"
          tooltip="How long each frame should take, in miliseconds"
          name="frameDelay"
        >
          <InputNumber
            addonAfter="ms"
            style={{ width: "100%" }}
            min={0}
            step={10}
          />
        </Form.Item>
        <Form.Item
          label="Last frame delay"
          tooltip="How long the last frame should linger, for maximum awesomeness! YEAH!"
        >
          <Space>
            <Form.Item
              noStyle
              valuePropName="checked"
              name={["lastFrameDelay", "enabled"]}
            >
              <Switch />
            </Form.Item>
            <Form.Item noStyle name={["lastFrameDelay", "value"]}>
              <InputNumber
                addonAfter="ms"
                style={{ width: "100%" }}
                min={10}
                step={100}
                disabled={!lastFrameDelayEnabled || status === "START"}
              />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item
          label="Largest dimension (width or height)"
          tooltip="The largest dimension of the output image - either width or height, depending on the aspect ratio."
          name="size"
        >
          <InputNumber addonAfter="px" style={{ width: "100%" }} min={1} />
        </Form.Item>
        <Button
          block
          disabled={glassesList.length === 0}
          type="primary"
          size="large"
          onClick={generateOutputImage}
          loading={status === "GENERATING"}
          icon={<FireOutlined />}
        >
          Deal with it!
        </Button>
        {status === "GENERATING" && (
          <Progress
            percent={progressState}
            showInfo={false}
            strokeColor={{ from: "#108ee9", to: "#87d068" }}
          />
        )}
      </Form>
    );
  }

  function closeModal() {
    posthog?.capture("user_closed_download_modal");
    setStatus("READY");
  }

  function downloadOutput() {
    posthog?.capture("user_downloaded_emoji");
    if (outputImage && inputFile) {
      saveAs(outputImage, generateOutputFilename(inputFile));
    }
    closeModal();
  }

  function onModalOpenChange(open: boolean) {
    if (open && outputImageRef.current) {
      posthog?.capture("user_opened_download_modal");

      if (mode === "HEDGEHOG") {
        const hedgehog = document.createElement("span");
        hedgehog.innerText = "🦔";
        hedgehog.style.fontSize = "48px";
        const heart = document.createElement("span");
        heart.innerText = "💖";
        heart.style.fontSize = "24px";
        party.confetti(outputImageRef.current, { shapes: [hedgehog, heart] });
      } else {
        party.confetti(outputImageRef.current);
      }
    }
  }

  const shouldRenderFileInput = ["START", "LOADING"].includes(status);

  return (
    <>
      <div className="flex w-full items-center justify-center">
        <span className="absolute mx-auto py-4 flex border w-fit bg-gradient-to-r blur-xl from-blue-500 via-teal-500 to-pink-500 bg-clip-text text-6xl box-content font-extrabold text-transparent text-center select-none">
          Deal With It GIF emoji generator
        </span>
        <h1 className="relative top-0 w-fit h-auto py-4 justify-center flex bg-gradient-to-r items-center from-blue-500 via-teal-500 to-pink-500 bg-clip-text text-6xl font-extrabold text-transparent text-center select-auto">
          Deal With It GIF emoji generator
        </h1>
      </div>
      <h3 className="leading-relaxed text-base text-center text-gray-500">
        All done artisanally and securely in your browser.
      </h3>
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        {contextHolder}
        <div className="relative p-10 bg-white dark:bg-slate-900 shadow-lg sm:rounded-3xl">
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              {shouldRenderFileInput ? renderFileInput() : renderInputImage()}
            </div>
            {renderForm()}
          </div>
          <Modal
            title={getSuccessMessage(successCount)}
            open={status === "DONE"}
            onCancel={closeModal}
            destroyOnClose
            afterOpenChange={onModalOpenChange}
            footer={[
              <Button
                key="download"
                type="primary"
                onClick={downloadOutput}
                icon={<DownloadOutlined />}
              >
                Download
              </Button>,
            ]}
            width={304}
          >
            {renderOutputImage()}
          </Modal>
        </div>
      </div>
      <div className="text-center">
        <Text type="secondary">
          Made with passion by{" "}
          <Link href="https://klimer.eu/" target="_blank">
            Igor Klimer
          </Link>
          . Source code on
          <Link
            className="ms-2"
            href="https://github.com/klimeryk/dealwithit"
            target="_blank"
          >
            <GithubOutlined className="mr-1" />
            GitHub
          </Link>
          .
        </Text>
      </div>
    </>
  );
}

export default App;
