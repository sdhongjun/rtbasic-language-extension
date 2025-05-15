' RtBasic Example File
' This file demonstrates various RtBasic language features

' Global variables with structure types
Global Dim point1, point2 As Point
Global Dim people(10) As Person  ' Array of structures

' File-level variables
Dim counter, index, total  ' Multiple variables in one line
Dim positions(100) As Point

' Global structure definitions
Global Structure Point
    Dim x, y  ' Multiple members
    Dim color
End Structure

Global Structure Person
    Dim name, address
    Dim age
    Dim location As Point
End Structure

' Sub with inline If-Then
Global Sub ProcessPoints(p1, p2)
    Local temp1, temp2 As Point  ' Local variables with structure type
    
    If p1.x > p2.x Then 
        temp1 = p1 
    Else 
        temp1 = p2
    End If
    
    ' Multi-variable assignment
    temp2.x = p1.x + p2.x
    temp2.y = p1.y + p2.y
    
    Print "Processed points"
End Sub

' Main subroutine
Global Sub Main()
    ' Initialize points
    point1.x = 10 : point1.y = 20
    point2.x = 30 : point2.y = 40
    
    ' Process points
    ProcessPoints(point1, point2)
    
    ' Initialize person
    people(0).name = "John"
    people(0).age = 30
    people(0).location = point1
End Sub