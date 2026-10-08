#include "glib.h"

#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <fnmatch.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include <algorithm>
#include <deque>
#include <fstream>
#include <string>
#include <vector>

#include "tinyxml2.h"
#include "utf8proc.h"

struct _GDir
{
    DIR *dir = nullptr;
    struct dirent *entry = nullptr;
};

struct _GPatternSpec
{
    std::string pattern;
};

struct _GMarkupParseContext
{
    const GMarkupParser *parser = nullptr;
    gpointer user_data = nullptr;
    GDestroyNotify user_data_dnotify = nullptr;
    // Lensfun's parser keeps the element_name pointers it is handed (its
    // context stack) until the element ends, as GLib allows. A deque never
    // moves its strings when it grows; a vector did, which left those
    // pointers dangling and made whole database files fail to parse.
    std::deque<std::string> element_stack;
    gint current_line = 1;
    gint current_column = 0;
};

static std::string vformat(const char *format, va_list args)
{
    va_list copy;
    va_copy(copy, args);
    const int needed = vsnprintf(nullptr, 0, format, copy);
    va_end(copy);

    if (needed <= 0)
    {
        return std::string();
    }

    std::string out(static_cast<size_t>(needed), '\0');
    vsnprintf(out.data(), out.size() + 1, format, args);
    return out;
}

static std::string xml_escape(const std::string &input)
{
    std::string out;
    out.reserve(input.size());
    for (char c : input)
    {
        switch (c)
        {
        case '&':
            out += "&amp;";
            break;
        case '<':
            out += "&lt;";
            break;
        case '>':
            out += "&gt;";
            break;
        case '\"':
            out += "&quot;";
            break;
        case '\'':
            out += "&apos;";
            break;
        default:
            out.push_back(c);
            break;
        }
    }
    return out;
}

extern "C" {

void g_assertion_message(const char *expr, const char *file, int line)
{
    fprintf(stderr, "[glib-compat] assertion failed: %s (%s:%d)\n", expr, file, line);
    abort();
}

void *g_malloc(gsize n_bytes)
{
    const gsize size = n_bytes == 0 ? 1 : n_bytes;
    void *ptr = malloc(size);
    if (!ptr)
    {
        fprintf(stderr, "[glib-compat] out of memory\n");
        abort();
    }
    return ptr;
}

void *g_realloc(gpointer mem, gsize n_bytes)
{
    const gsize size = n_bytes == 0 ? 1 : n_bytes;
    void *ptr = realloc(mem, size);
    if (!ptr)
    {
        fprintf(stderr, "[glib-compat] out of memory\n");
        abort();
    }
    return ptr;
}

void g_free(gpointer mem)
{
    free(mem);
}

gchar *g_strdup(const gchar *str)
{
    if (!str)
    {
        return nullptr;
    }
    const size_t len = strlen(str) + 1;
    auto *copy = static_cast<gchar *>(g_malloc(len));
    memcpy(copy, str, len);
    return copy;
}

void g_mutex_lock(GMutex *mutex)
{
    if (mutex)
    {
        mutex->lock.lock();
    }
}

void g_mutex_unlock(GMutex *mutex)
{
    if (mutex)
    {
        mutex->lock.unlock();
    }
}

void g_static_mutex_lock(GStaticMutex *mutex)
{
    if (mutex)
    {
        mutex->lock.lock();
    }
}

void g_static_mutex_unlock(GStaticMutex *mutex)
{
    if (mutex)
    {
        mutex->lock.unlock();
    }
}

gchar *g_build_filename(const gchar *first_element, ...)
{
    if (!first_element)
    {
        return g_strdup("");
    }

    std::vector<std::string> parts;
    va_list args;
    va_start(args, first_element);

    const gchar *part = first_element;
    while (part)
    {
        if (*part)
        {
            parts.emplace_back(part);
        }
        part = va_arg(args, const gchar *);
    }

    va_end(args);

    if (parts.empty())
    {
        return g_strdup("");
    }

    std::string out;
    out.reserve(128);
    for (size_t i = 0; i < parts.size(); ++i)
    {
        const std::string &p = parts[i];
        if (i > 0 && !out.empty() && out.back() != '/')
        {
            out.push_back('/');
        }
        if (i > 0 && !p.empty() && p.front() == '/')
        {
            out += p.substr(1);
        }
        else
        {
            out += p;
        }
    }

    return g_strdup(out.c_str());
}

const gchar *g_get_user_data_dir(void)
{
    static const char *path = "/tmp";
    return path;
}

int g_open(const char *filename, int flags, int mode)
{
    return open(filename, flags, mode);
}

gboolean g_file_test(const gchar *filename, GFileTest test)
{
    if (!filename)
    {
        return FALSE;
    }

    struct stat st;
    if (stat(filename, &st) != 0)
    {
        return FALSE;
    }

    if (test == G_FILE_TEST_IS_DIR)
    {
        return S_ISDIR(st.st_mode) ? TRUE : FALSE;
    }

    return FALSE;
}

gboolean g_file_get_contents(const gchar *filename, gchar **contents, gsize *length, GError **error)
{
    if (!filename || !contents)
    {
        if (error)
        {
            g_set_error(error, G_FILE_ERROR, G_FILE_ERROR_NOENT, "Invalid filename");
        }
        return FALSE;
    }

    std::ifstream in(filename, std::ios::binary);
    if (!in)
    {
        const int code = (errno == EACCES) ? G_FILE_ERROR_ACCES : G_FILE_ERROR_NOENT;
        if (error)
        {
            g_set_error(error, G_FILE_ERROR, code, "Cannot read file %s", filename);
        }
        return FALSE;
    }

    std::string data((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());

    auto *buf = static_cast<gchar *>(g_malloc(data.size() + 1));
    if (!data.empty())
    {
        memcpy(buf, data.data(), data.size());
    }
    buf[data.size()] = '\0';

    *contents = buf;
    if (length)
    {
        *length = data.size();
    }

    return TRUE;
}

GDir *g_dir_open(const gchar *path, guint, GError **error)
{
    DIR *dir = opendir(path);
    if (!dir)
    {
        if (error)
        {
            g_set_error(error, G_FILE_ERROR, errno == EACCES ? G_FILE_ERROR_ACCES : G_FILE_ERROR_NOENT, "Cannot open directory %s", path);
        }
        return nullptr;
    }

    auto *gdir = static_cast<GDir *>(g_malloc(sizeof(GDir)));
    gdir->dir = dir;
    gdir->entry = nullptr;
    return gdir;
}

const gchar *g_dir_read_name(GDir *dir)
{
    if (!dir || !dir->dir)
    {
        return nullptr;
    }

    while ((dir->entry = readdir(dir->dir)) != nullptr)
    {
        const char *name = dir->entry->d_name;
        if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0)
        {
            continue;
        }
        return name;
    }

    return nullptr;
}

void g_dir_close(GDir *dir)
{
    if (!dir)
    {
        return;
    }
    if (dir->dir)
    {
        closedir(dir->dir);
    }
    g_free(dir);
}

GPatternSpec *g_pattern_spec_new(const gchar *pattern)
{
    auto *spec = static_cast<GPatternSpec *>(g_malloc(sizeof(GPatternSpec)));
    new (&spec->pattern) std::string(pattern ? pattern : "");
    return spec;
}

gboolean g_pattern_match(GPatternSpec *pspec, gsize, const gchar *string, const gchar *)
{
    if (!pspec || !string)
    {
        return FALSE;
    }
    return fnmatch(pspec->pattern.c_str(), string, 0) == 0 ? TRUE : FALSE;
}

void g_pattern_spec_free(GPatternSpec *pspec)
{
    if (!pspec)
    {
        return;
    }
    pspec->pattern.~basic_string();
    g_free(pspec);
}

GString *g_string_sized_new(gsize dfl_size)
{
    auto *str = static_cast<GString *>(g_malloc(sizeof(GString)));
    str->allocated_len = std::max<gsize>(dfl_size + 1, 16);
    str->len = 0;
    str->str = static_cast<gchar *>(g_malloc(str->allocated_len));
    str->str[0] = '\0';
    return str;
}

GString *g_string_append(GString *string, const gchar *val)
{
    if (!string || !val)
    {
        return string;
    }
    const gsize add_len = strlen(val);
    const gsize needed = string->len + add_len + 1;
    if (needed > string->allocated_len)
    {
        gsize next = string->allocated_len;
        while (next < needed)
        {
            next *= 2;
        }
        string->str = static_cast<gchar *>(g_realloc(string->str, next));
        string->allocated_len = next;
    }

    memcpy(string->str + string->len, val, add_len + 1);
    string->len += add_len;
    return string;
}

gchar *g_string_free(GString *string, gboolean free_segment)
{
    if (!string)
    {
        return nullptr;
    }

    gchar *segment = string->str;
    if (free_segment)
    {
        g_free(segment);
        segment = nullptr;
    }

    g_free(string);
    return segment;
}

GPtrArray *g_ptr_array_new(void)
{
    auto *array = static_cast<GPtrArray *>(g_malloc(sizeof(GPtrArray)));
    array->pdata = nullptr;
    array->len = 0;
    array->allocated_len = 0;
    return array;
}

void g_ptr_array_set_size(GPtrArray *array, gint length)
{
    if (!array || length < 0)
    {
        return;
    }

    const guint target = static_cast<guint>(length);
    if (target > array->allocated_len)
    {
        guint next = array->allocated_len == 0 ? 8U : array->allocated_len;
        while (next < target)
        {
            next *= 2U;
        }
        array->pdata = static_cast<gpointer *>(g_realloc(array->pdata, sizeof(gpointer) * next));
        for (guint i = array->allocated_len; i < next; ++i)
        {
            array->pdata[i] = nullptr;
        }
        array->allocated_len = next;
    }

    if (target > array->len)
    {
        for (guint i = array->len; i < target; ++i)
        {
            array->pdata[i] = nullptr;
        }
    }

    array->len = target;
}

gpointer *g_ptr_array_free(GPtrArray *array, gboolean free_segment)
{
    if (!array)
    {
        return nullptr;
    }

    gpointer *segment = array->pdata;
    if (free_segment)
    {
        g_free(segment);
        segment = nullptr;
    }

    g_free(array);
    return segment;
}

void g_warning(const gchar *format, ...)
{
    va_list args;
    va_start(args, format);
    std::string message = vformat(format, args);
    va_end(args);
    fprintf(stderr, "%s\n", message.c_str());
}

void g_set_error(GError **err, gint domain, gint code, const gchar *format, ...)
{
    if (!err)
    {
        return;
    }

    va_list args;
    va_start(args, format);
    std::string message = vformat(format, args);
    va_end(args);

    auto *e = static_cast<GError *>(g_malloc(sizeof(GError)));
    e->domain = domain;
    e->code = code;
    e->message = g_strdup(message.c_str());
    *err = e;
}

gunichar g_utf8_get_char(const gchar *p)
{
    if (!p || *p == '\0')
    {
        return 0;
    }

    utf8proc_int32_t codepoint = 0;
    utf8proc_ssize_t len = utf8proc_iterate(reinterpret_cast<const utf8proc_uint8_t *>(p), -1, &codepoint);
    if (len < 0)
    {
        return static_cast<gunichar>(*reinterpret_cast<const unsigned char *>(p));
    }
    return static_cast<gunichar>(codepoint);
}

const gchar *g_utf8_next_char(const gchar *p)
{
    if (!p || *p == '\0')
    {
        return p;
    }

    const int width = utf8proc_charwidth(static_cast<utf8proc_int8_t>(*p));
    if (width <= 0)
    {
        return p + 1;
    }
    return p + width;
}

gchar *g_utf8_casefold(const gchar *str, gssize len)
{
    if (!str)
    {
        return nullptr;
    }

    utf8proc_uint8_t *mapped = nullptr;
    utf8proc_ssize_t rc = utf8proc_map(
        reinterpret_cast<const utf8proc_uint8_t *>(str),
        static_cast<utf8proc_ssize_t>(len),
        &mapped,
        static_cast<utf8proc_option_t>(UTF8PROC_CASEFOLD | UTF8PROC_STABLE));

    if (rc < 0 || !mapped)
    {
        return g_strdup("");
    }

    return reinterpret_cast<gchar *>(mapped);
}

gboolean g_unichar_isspace(gunichar c)
{
    if (c <= 0x7F)
    {
        return (c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == '\f' || c == '\v') ? TRUE : FALSE;
    }

    const utf8proc_category_t cat = utf8proc_category(static_cast<utf8proc_int32_t>(c));
    return (cat == UTF8PROC_CATEGORY_ZS || cat == UTF8PROC_CATEGORY_ZL || cat == UTF8PROC_CATEGORY_ZP) ? TRUE : FALSE;
}

gunichar g_unichar_tolower(gunichar c)
{
    return static_cast<gunichar>(utf8proc_tolower(static_cast<utf8proc_int32_t>(c)));
}

static gboolean walk_element(
    GMarkupParseContext *context,
    tinyxml2::XMLElement *element,
    GError **error)
{
    context->element_stack.emplace_back(element->Name() ? element->Name() : "");
    context->current_line = element->GetLineNum();
    context->current_column = 0;

    std::vector<const gchar *> attr_names;
    std::vector<const gchar *> attr_values;

    for (const tinyxml2::XMLAttribute *attr = element->FirstAttribute(); attr; attr = attr->Next())
    {
        attr_names.push_back(attr->Name());
        attr_values.push_back(attr->Value());
    }
    attr_names.push_back(nullptr);
    attr_values.push_back(nullptr);

    if (context->parser && context->parser->start_element)
    {
        context->parser->start_element(
            context,
            context->element_stack.back().c_str(),
            attr_names.data(),
            attr_values.data(),
            context->user_data,
            error);

        if (error && *error)
        {
            context->element_stack.pop_back();
            return FALSE;
        }
    }

    for (tinyxml2::XMLNode *child = element->FirstChild(); child; child = child->NextSibling())
    {
        if (auto *text = child->ToText())
        {
            if (context->parser && context->parser->text)
            {
                const char *value = text->Value();
                if (value)
                {
                    context->current_line = text->GetLineNum();
                    context->parser->text(context, value, strlen(value), context->user_data, error);
                    if (error && *error)
                    {
                        context->element_stack.pop_back();
                        return FALSE;
                    }
                }
            }
            continue;
        }

        if (auto *nested = child->ToElement())
        {
            if (!walk_element(context, nested, error))
            {
                context->element_stack.pop_back();
                return FALSE;
            }
        }
    }

    if (context->parser && context->parser->end_element)
    {
        context->parser->end_element(
            context,
            context->element_stack.back().c_str(),
            context->user_data,
            error);
        if (error && *error)
        {
            context->element_stack.pop_back();
            return FALSE;
        }
    }

    context->element_stack.pop_back();
    return TRUE;
}

GMarkupParseContext *g_markup_parse_context_new(
    const GMarkupParser *parser,
    GMarkupParseFlags,
    gpointer user_data,
    GDestroyNotify user_data_dnotify)
{
    auto *ctx = static_cast<GMarkupParseContext *>(g_malloc(sizeof(GMarkupParseContext)));
    new (ctx) GMarkupParseContext();
    ctx->parser = parser;
    ctx->user_data = user_data;
    ctx->user_data_dnotify = user_data_dnotify;
    return ctx;
}

gboolean g_markup_parse_context_parse(
    GMarkupParseContext *context,
    const gchar *text,
    gssize text_len,
    GError **error)
{
    if (!context || !text)
    {
        if (error)
        {
            g_set_error(error, G_MARKUP_ERROR, G_MARKUP_ERROR_INVALID_CONTENT, "Invalid markup input");
        }
        return FALSE;
    }

    tinyxml2::XMLDocument doc;
    tinyxml2::XMLError rc;
    if (text_len < 0)
    {
        rc = doc.Parse(text);
    }
    else
    {
        rc = doc.Parse(text, static_cast<size_t>(text_len));
    }

    if (rc != tinyxml2::XML_SUCCESS)
    {
        context->current_line = doc.ErrorLineNum();
        if (error)
        {
            g_set_error(error, G_MARKUP_ERROR, G_MARKUP_ERROR_INVALID_CONTENT, "%s", doc.ErrorStr());
        }
        return FALSE;
    }

    for (tinyxml2::XMLElement *root = doc.FirstChildElement(); root; root = root->NextSiblingElement())
    {
        if (!walk_element(context, root, error))
        {
            return FALSE;
        }
    }

    return TRUE;
}

void g_markup_parse_context_free(GMarkupParseContext *context)
{
    if (!context)
    {
        return;
    }

    if (context->user_data_dnotify)
    {
        context->user_data_dnotify(context->user_data);
    }

    context->~_GMarkupParseContext();
    g_free(context);
}

const gchar *g_markup_parse_context_get_element(GMarkupParseContext *context)
{
    if (!context || context->element_stack.empty())
    {
        return nullptr;
    }

    return context->element_stack.back().c_str();
}

void g_markup_parse_context_get_position(GMarkupParseContext *context, gint *line_number, gint *char_number)
{
    if (!context)
    {
        if (line_number)
        {
            *line_number = 1;
        }
        if (char_number)
        {
            *char_number = 0;
        }
        return;
    }

    if (line_number)
    {
        *line_number = context->current_line;
    }
    if (char_number)
    {
        *char_number = context->current_column;
    }
}

gchar *g_markup_vprintf_escaped(const gchar *format, va_list args)
{
    if (!format)
    {
        return g_strdup("");
    }

    std::string raw = vformat(format, args);
    std::string escaped = xml_escape(raw);
    return g_strdup(escaped.c_str());
}

gchar *g_markup_printf_escaped(const gchar *format, ...)
{
    va_list args;
    va_start(args, format);
    gchar *result = g_markup_vprintf_escaped(format, args);
    va_end(args);
    return result;
}

} // extern "C"
