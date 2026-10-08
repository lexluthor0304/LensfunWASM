cmake_minimum_required(VERSION 3.20)
project(lensfun_wasm_bridge C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(LENSFUN_ROOT "${CMAKE_SOURCE_DIR}/../third_party/lensfun")
set(TINYXML2_ROOT "${CMAKE_SOURCE_DIR}/../third_party/tinyxml2")
set(UTF8PROC_ROOT "${CMAKE_SOURCE_DIR}/../third_party/utf8proc")

set(VERSION_MAJOR 0)
set(VERSION_MINOR 3)
set(VERSION_MICRO 99)
set(VERSION_BUGFIX 0)
set(LENSFUN_DB_VERSION 2)
set(LENSFUN_GLIB_REQUIREMENT_MACRO "GLIB_VERSION_2_26")

set(CMAKE_INSTALL_FULL_DATAROOTDIR "/usr/local/share")
set(CMAKE_INSTALL_LOCALSTATEDIR "var")
set(CMAKE_INSTALL_DATAROOTDIR "share")

configure_file(
  "${LENSFUN_ROOT}/include/lensfun/config.h.in.cmake"
  "${CMAKE_BINARY_DIR}/config.h"
)

configure_file(
  "${LENSFUN_ROOT}/include/lensfun/lensfun.h.in"
  "${CMAKE_BINARY_DIR}/lensfun.h"
  @ONLY
)

set(LENSFUN_SOURCES
  "${LENSFUN_ROOT}/libs/lensfun/auxfun.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/camera.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/database.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/lens.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/mount.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/mod-color.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/mod-coord.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/mod-pc.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/mod-subpix.cpp"
  "${LENSFUN_ROOT}/libs/lensfun/modifier.cpp"
  "${CMAKE_SOURCE_DIR}/src/cpuid_stub.cpp"
)

set(COMPAT_SOURCES
  "${CMAKE_SOURCE_DIR}/src/glib_compat.cpp"
  "${TINYXML2_ROOT}/tinyxml2.cpp"
  "${UTF8PROC_ROOT}/utf8proc.c"
)

add_library(lensfun_runtime STATIC
  ${LENSFUN_SOURCES}
  ${COMPAT_SOURCES}
  "${CMAKE_SOURCE_DIR}/src/lensfun_wasm_bridge.cpp"
)

target_include_directories(lensfun_runtime PRIVATE
  "${CMAKE_BINARY_DIR}"
  "${CMAKE_SOURCE_DIR}/include"
  "${LENSFUN_ROOT}/libs/lensfun"
  "${LENSFUN_ROOT}/include/lensfun"
  "${TINYXML2_ROOT}"
  "${UTF8PROC_ROOT}"
)

target_compile_definitions(lensfun_runtime PRIVATE
  CONF_LENSFUN_STATIC
)

if(EMSCRIPTEN)
  add_executable(lensfun-core "${CMAKE_SOURCE_DIR}/src/entrypoint.cpp")
  target_link_libraries(lensfun-core PRIVATE lensfun_runtime)
  target_link_options(lensfun-core PRIVATE
    "-O3"
    "-sMODULARIZE=1"
    "-sEXPORT_NAME=createLensfunCoreModule"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sFILESYSTEM=1"
    "-sFORCE_FILESYSTEM=1"
    "-sENVIRONMENT=web,worker"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_lfw_init','_lfw_dispose','_lfw_find_lenses_json','_lfw_find_cameras_json','_lfw_available_mods','_lfw_grid_flags','_lfw_build_geometry_map','_lfw_build_tca_map','_lfw_build_subpixel_geometry_map','_lfw_build_vignetting_map','_lfw_free']"
    # HEAPF32: the JS API copies the maps out of the heap. Emscripten puts no
    # HEAP views on Module unless they are listed here.
    "-sEXPORTED_RUNTIME_METHODS=['cwrap','UTF8ToString','stringToUTF8','lengthBytesUTF8','HEAPF32']"
    "--preload-file"
    "${LENSFUN_ROOT}/data/db@/lensfun-db"
  )
  set_target_properties(lensfun-core PROPERTIES SUFFIX ".js")
endif()
